import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  CLOCK,
  type ClockPort,
  type DomainError,
  idempotencyHashOf,
  IdempotencyKey,
  Result,
  uuidV4,
  uuidV7,
} from '@/shared/kernel';

import { newPendingPayment, type Payment } from '../../domain/entities/payment.entity';
import { PaymentAttemptsExceededError } from '../../domain/errors/payment-attempts-exceeded.error';
import { PaymentIdempotencyConflictError } from '../../domain/errors/payment-idempotency-conflict.error';
import { PaymentInProgressError } from '../../domain/errors/payment-in-progress.error';
import { PaymentOfferNotFoundError } from '../../domain/errors/payment-offer-not-found.error';
import { PaymentUnavailableError } from '../../domain/errors/payment-unavailable.error';
import { BILLING, type BillingPort, type PayableOffer } from '../../domain/ports/billing.port';
import { PAYMENT_GATEWAY, type PaymentGatewayPort } from '../../domain/ports/payment-gateway.port';
import {
  PAYMENT_REPOSITORY,
  type PaymentRepositoryPort,
} from '../../domain/ports/payment-repository.port';
import { PHONE_HASHER, type PhoneHasherPort } from '../../domain/ports/phone-hasher.port';
import { paymentDescription } from '../../domain/services/payment-description';
import { attemptRefusalFor, attemptWindows } from '../../domain/services/payment-policy';
import { MobileMoneyNumber } from '../../domain/value-objects/mobile-money-number.vo';
import { PaymentFailureCode, PaymentStatus } from '../../domain/value-objects/payment-status.vo';

export interface InitiatePaymentInput {
  readonly userId: string;
  readonly offerCode: string;
  readonly phoneNumber: string;
  /** En-tête `Idempotency-Key` (obligatoire, ADR-0021 §7). */
  readonly idempotencyKey: string;
}

/**
 * `POST /v1/payments` : demande le paiement d'une offre par Mobile Money
 * (RF-23, ADR-0021 §2). Le prix est **recopié du catalogue**, jamais lu dans
 * la requête. Le paiement est enregistré `pending` **avant** l'appel au
 * prestataire : une réponse perdue se rattrape avec la même clé (§8).
 *
 * Idempotent par `Idempotency-Key` : même clé et même requête → même
 * paiement, sans nouvelle demande au téléphone (§7).
 */
@Injectable()
export class InitiatePaymentUseCase {
  private readonly logger = new Logger(InitiatePaymentUseCase.name);

  constructor(
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGatewayPort,
    @Inject(PAYMENT_REPOSITORY) private readonly payments: PaymentRepositoryPort,
    @Inject(BILLING) private readonly billing: BillingPort,
    @Inject(PHONE_HASHER) private readonly hasher: PhoneHasherPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
  ) {}

  async execute(input: InitiatePaymentInput): Promise<Result<Payment, DomainError>> {
    const provider = this.gateway.provider;
    if (provider === null) return Result.err(new PaymentUnavailableError('Payments are disabled'));

    const key = IdempotencyKey.of(input.idempotencyKey);
    if (key.isErr()) return Result.err(key.error);
    const phone = MobileMoneyNumber.of(input.phoneNumber);
    if (phone.isErr()) return Result.err(phone.error);

    const phoneHmac = this.hasher.keyOf(phone.value);
    // Empreinte de la requête sans le numéro en clair (un SHA-256 se renverse).
    const requestHash = idempotencyHashOf({ offerCode: input.offerCode, phoneHmac });

    const existing = await this.payments.findByIdempotencyKey(input.userId, key.value);
    if (existing !== null) return this.replay(existing, requestHash, phone.value);

    const offer = await this.billing.findOffer(input.offerCode);
    if (offer === null) return Result.err(new PaymentOfferNotFoundError(input.offerCode));

    const now = this.clock.now();
    const counts = await this.payments.countAttempts(input.userId, phoneHmac, attemptWindows(now));
    if (counts.inFlightPaymentId !== null) {
      return Result.err(new PaymentInProgressError(counts.inFlightPaymentId));
    }
    const refusal = attemptRefusalFor(counts);
    if (refusal !== null) {
      return Result.err(
        new PaymentAttemptsExceededError('Too many payment attempts, try again later', {
          details: { reason: refusal },
        }),
      );
    }

    const payment = newPendingPayment({
      id: uuidV7(),
      userId: input.userId,
      offerCode: offer.code,
      amountXaf: offer.priceXaf,
      idempotencyKey: key.value,
      requestHash,
      provider,
      externalReference: uuidV4(),
      phoneHmac,
      phoneSuffix: MobileMoneyNumber.suffix(phone.value),
      now,
    });
    if (!(await this.payments.insert(payment))) {
      // Même clé envoyée deux fois en même temps : la première fait foi.
      const winner = await this.payments.findByIdempotencyKey(input.userId, key.value);
      if (winner === null) throw new Error('Payment vanished after an idempotency conflict');
      return winner.requestHash === requestHash
        ? Result.ok(winner)
        : Result.err(new PaymentIdempotencyConflictError());
    }
    return this.collect(payment, offer, phone.value);
  }

  /**
   * Requête rejouée. Un paiement resté sans référence du prestataire (réponse
   * perdue) est redemandé avec le **même** `external_reference` : le
   * prestataire renvoie la même transaction, sans double débit (§8).
   */
  private async replay(
    existing: Payment,
    requestHash: string,
    phone: MobileMoneyNumber,
  ): Promise<Result<Payment, DomainError>> {
    if (existing.requestHash !== requestHash) {
      return Result.err(new PaymentIdempotencyConflictError());
    }
    if (existing.status !== PaymentStatus.PENDING || existing.providerReference !== null) {
      return Result.ok(existing);
    }
    const offer = await this.billing.findOffer(existing.offerCode);
    // Offre retirée entre-temps : le paiement expirera sans référence.
    if (offer === null) return Result.ok(existing);
    return this.collect(existing, offer, phone);
  }

  private async collect(
    payment: Payment,
    offer: PayableOffer,
    phone: MobileMoneyNumber,
  ): Promise<Result<Payment, DomainError>> {
    const collected = await this.gateway.collect({
      externalReference: payment.externalReference,
      amountXaf: payment.amountXaf,
      phone,
      description: paymentDescription(offer),
    });
    const now = this.clock.now();
    if (collected.isOk()) {
      await this.payments.attachProviderReference(payment.id, collected.value.reference, now);
      return Result.ok({
        ...payment,
        providerReference: collected.value.reference,
        updatedAt: now,
      });
    }

    const error = collected.error;
    if (error instanceof PaymentUnavailableError) {
      // Le paiement reste `pending` sans référence : nouvel essai avec la
      // même clé, ou notification retrouvée par `external_reference` (§8).
      this.logger.warn({ paymentId: payment.id, err: error }, 'payment.collect_unavailable');
      return Result.err(error);
    }
    // Numéro refusé par le prestataire (opérateur non pris en charge).
    await this.payments.complete(
      payment.id,
      PaymentStatus.PENDING,
      { status: PaymentStatus.FAILED, via: null, failureCode: PaymentFailureCode.INVALID_PHONE },
      now,
    );
    return Result.err(error);
  }
}
