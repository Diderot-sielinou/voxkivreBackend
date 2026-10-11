import { Inject, Injectable, Logger } from '@nestjs/common';

import { CLOCK, type ClockPort, Result } from '@/shared/kernel';
import { UNIT_OF_WORK, type UnitOfWorkPort } from '@/shared/persistence/unit-of-work.port';

import { type Payment } from '../../domain/entities/payment.entity';
import { type PaymentUnavailableError } from '../../domain/errors/payment-unavailable.error';
import { BILLING, type BillingPort } from '../../domain/ports/billing.port';
import { PAYMENT_GATEWAY, type PaymentGatewayPort } from '../../domain/ports/payment-gateway.port';
import {
  PAYMENT_REPOSITORY,
  type PaymentRepositoryPort,
} from '../../domain/ports/payment-repository.port';
import { type ProviderTransaction } from '../../domain/provider-transaction';
import { settlementFor } from '../../domain/services/settlement';
import {
  type ConfirmationChannel,
  PaymentStatus,
} from '../../domain/value-objects/payment-status.vo';

/**
 * Ce qu'a donné un règlement :
 * - `succeeded` / `failed` / `amount_mismatch` : le paiement vient d'être conclu ;
 * - `waiting` : toujours en attente chez le prestataire (ou rien à relire) ;
 * - `unchanged` : déjà conclu dans le même sens (notification rejouée) ;
 * - `raced` : un autre chemin l'a conclu entre la lecture et l'écriture ;
 * - `anomaly` : incohérence journalisée, à examiner à la main.
 */
export type SettlementOutcome =
  'succeeded' | 'failed' | 'amount_mismatch' | 'waiting' | 'unchanged' | 'raced' | 'anomaly';

/**
 * Relit l'état d'un paiement **chez le prestataire** et l'applique
 * (ADR-0021 §3–6). Partagé par la notification et le balayage : un seul
 * chemin de décision, quelle que soit la façon dont on a été prévenu.
 */
@Injectable()
export class PaymentSettler {
  private readonly logger = new Logger(PaymentSettler.name);

  constructor(
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGatewayPort,
    @Inject(PAYMENT_REPOSITORY) private readonly payments: PaymentRepositoryPort,
    @Inject(BILLING) private readonly billing: BillingPort,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWorkPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
  ) {}

  /** Règle un paiement avec sa propre référence ; sans référence, rien à relire. */
  settle(
    payment: Payment,
    via: ConfirmationChannel,
  ): Promise<Result<SettlementOutcome, PaymentUnavailableError>> {
    if (payment.providerReference === null) return Promise.resolve(Result.ok('waiting'));
    return this.settleWithReference(payment, payment.providerReference, via);
  }

  /**
   * Règle un paiement avec la référence désignée par une notification. Un
   * paiement resté sans référence (réponse perdue, §8) la reçoit ici,
   * **seulement** si la transaction relue porte bien notre référence.
   */
  async settleWithReference(
    payment: Payment,
    reference: string,
    via: ConfirmationChannel,
  ): Promise<Result<SettlementOutcome, PaymentUnavailableError>> {
    const read = await this.gateway.getTransaction(reference);
    if (read.isErr()) return Result.err(read.error);
    const transaction = read.value;

    const decision = settlementFor(payment, transaction);
    if (payment.providerReference === null && decision.kind !== 'anomaly') {
      await this.payments.attachProviderReference(payment.id, reference, this.clock.now());
    }
    return Result.ok(await this.apply(payment, transaction, decision, via));
  }

  private async apply(
    payment: Payment,
    transaction: ProviderTransaction,
    decision: ReturnType<typeof settlementFor>,
    via: ConfirmationChannel,
  ): Promise<SettlementOutcome> {
    const now = this.clock.now();
    switch (decision.kind) {
      case 'succeed': {
        return this.succeed(payment, decision.from, via, now);
      }
      case 'fail': {
        const moved = await this.payments.complete(
          payment.id,
          PaymentStatus.PENDING,
          { status: PaymentStatus.FAILED, via, failureCode: decision.failureCode },
          now,
        );
        return moved ? 'failed' : 'raced';
      }
      case 'flag_amount_mismatch': {
        const moved = await this.payments.complete(
          payment.id,
          payment.status,
          { status: PaymentStatus.AMOUNT_MISMATCH, via },
          now,
        );
        if (!moved) return 'raced';
        this.logger.error(
          {
            paymentId: payment.id,
            expectedXaf: payment.amountXaf,
            receivedAmount: transaction.amount,
            receivedCurrency: transaction.currency,
          },
          'payment.amount_mismatch',
        );
        return 'amount_mismatch';
      }
      case 'wait': {
        return 'waiting';
      }
      case 'none': {
        return 'unchanged';
      }
      case 'anomaly': {
        this.logger.error(
          {
            paymentId: payment.id,
            reason: decision.reason,
            status: payment.status,
            providerStatus: transaction.status,
          },
          'payment.anomaly',
        );
        return 'anomaly';
      }
    }
  }

  /**
   * Passage en `succeeded` **et** accord de l'offre dans la même transaction
   * (§6) : l'un ne va jamais sans l'autre.
   */
  private async succeed(
    payment: Payment,
    from: PaymentStatus,
    via: ConfirmationChannel,
    now: Date,
  ): Promise<SettlementOutcome> {
    const moved = await this.uow.withTransaction(async (tx) => {
      const completed = await this.payments.complete(
        payment.id,
        from,
        { status: PaymentStatus.SUCCEEDED, via },
        now,
        tx,
      );
      if (!completed) return false;
      const granted = await this.billing.grant({
        paymentReference: payment.id,
        userId: payment.userId,
        offerCode: payment.offerCode,
      });
      // Invariant : l'offre (jamais supprimée) et la référence (notre id)
      // ne peuvent pas être refusées. Sinon, on annule tout plutôt que de
      // laisser un paiement réussi sans offre ; l'erreur remonte.
      if (granted.isErr()) {
        throw new Error(`Grant refused for payment ${payment.id}`, { cause: granted.error });
      }
      return true;
    });
    if (!moved) return 'raced';
    // Argent encaissé et droits accordés : trace d'audit (observability.md).
    this.logger.log(
      {
        audit: true,
        actor: 'system',
        action: 'payment.succeeded',
        target: payment.id,
        result: 'ok',
        userId: payment.userId,
        offerCode: payment.offerCode,
        amountXaf: payment.amountXaf,
        via,
        afterExpiry: from === PaymentStatus.EXPIRED,
      },
      'payment.succeeded',
    );
    return 'succeeded';
  }
}
