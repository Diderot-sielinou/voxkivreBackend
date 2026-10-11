import { Inject, Injectable, Logger } from '@nestjs/common';

import { type DomainError, Result } from '@/shared/kernel';

import { InvalidPaymentNotificationError } from '../../domain/errors/invalid-payment-notification.error';
import { PAYMENT_GATEWAY, type PaymentGatewayPort } from '../../domain/ports/payment-gateway.port';
import {
  PAYMENT_REPOSITORY,
  type PaymentRepositoryPort,
} from '../../domain/ports/payment-repository.port';
import { ConfirmationChannel } from '../../domain/value-objects/payment-status.vo';
import { PaymentSettler, type SettlementOutcome } from '../services/payment-settler.service';

/** `ignored` : notification signée mais qui ne désigne aucun de nos paiements. */
export type NotificationOutcome = SettlementOutcome | 'ignored';

/**
 * `POST /v1/webhooks/campay` (ADR-0021 §3) : la notification n'est qu'un
 * **signal**. Sa signature est vérifiée, puis l'état est relu chez le
 * prestataire avec nos identifiants ; son statut et son montant ne sont
 * jamais lus. Rejouée, elle ne change rien (RNF-09).
 *
 * Erreurs : signature invalide → 401 ; prestataire injoignable → 503, pour
 * qu'il réessaie. Paiement inconnu → succès (`ignored`), pour qu'il cesse.
 */
@Injectable()
export class HandlePaymentNotificationUseCase {
  private readonly logger = new Logger(HandlePaymentNotificationUseCase.name);

  constructor(
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGatewayPort,
    @Inject(PAYMENT_REPOSITORY) private readonly payments: PaymentRepositoryPort,
    private readonly settler: PaymentSettler,
  ) {}

  async execute(
    payload: Readonly<Record<string, unknown>>,
  ): Promise<Result<NotificationOutcome, DomainError>> {
    const provider = this.gateway.provider;
    if (provider === null) {
      return Result.err(new InvalidPaymentNotificationError('Payments are disabled'));
    }
    const target = this.gateway.verifyNotification(payload);
    if (target.isErr()) return Result.err(target.error);
    const { reference, externalReference } = target.value;

    const payment =
      (await this.payments.findByProviderReference(provider, reference)) ??
      (externalReference === null
        ? null
        : await this.payments.findByExternalReference(externalReference));
    if (payment === null) {
      // Paiement d'une autre application du même compte, ou purgé : rien à faire.
      this.logger.warn({ provider }, 'payment.notification_unknown');
      return Result.ok('ignored');
    }

    const settled = await this.settler.settleWithReference(
      payment,
      reference,
      ConfirmationChannel.WEBHOOK,
    );
    if (settled.isErr()) return Result.err(settled.error);
    return Result.ok(settled.value);
  }
}
