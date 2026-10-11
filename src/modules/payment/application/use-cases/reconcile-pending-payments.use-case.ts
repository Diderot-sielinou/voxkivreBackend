import { Inject, Injectable } from '@nestjs/common';

import { CLOCK, type ClockPort } from '@/shared/kernel';

import { type Payment } from '../../domain/entities/payment.entity';
import {
  PAYMENT_REPOSITORY,
  type PaymentRepositoryPort,
} from '../../domain/ports/payment-repository.port';
import { isExpiryDue, sweepCutoff } from '../../domain/services/payment-policy';
import {
  ConfirmationChannel,
  PaymentFailureCode,
  PaymentStatus,
} from '../../domain/value-objects/payment-status.vo';
import { PaymentSettler, type SettlementOutcome } from '../services/payment-settler.service';

/** Paiements relus par passage : borne le temps d'un balayage. */
export const RECONCILE_BATCH_SIZE = 100;

/** Bilan d'un balayage, journalisé par la tâche planifiée (RNF-27). */
export type ReconciliationReport = Readonly<
  Record<SettlementOutcome | 'expired' | 'unavailable', number>
> & { readonly examined: number };

/**
 * Réconciliation (RNF-13, ADR-0021 §9) : relit chez le prestataire chaque
 * paiement `pending` que la notification n'a pas conclu après 2 min, et le
 * règle comme elle l'aurait fait. Abandonne (`expired`) ceux restés sans
 * réponse définitive : 24 h, ou 15 min sans référence du prestataire.
 *
 * Rattrape aussi les notifications envoyées pendant l'arrêt nocturne.
 */
@Injectable()
export class ReconcilePendingPaymentsUseCase {
  constructor(
    @Inject(PAYMENT_REPOSITORY) private readonly payments: PaymentRepositoryPort,
    private readonly settler: PaymentSettler,
    @Inject(CLOCK) private readonly clock: ClockPort,
  ) {}

  async execute(): Promise<ReconciliationReport> {
    const pending = await this.payments.listPendingCreatedBefore(
      sweepCutoff(this.clock.now()),
      RECONCILE_BATCH_SIZE,
    );
    const counts: Record<SettlementOutcome | 'expired' | 'unavailable', number> = {
      succeeded: 0,
      failed: 0,
      amount_mismatch: 0,
      waiting: 0,
      unchanged: 0,
      raced: 0,
      anomaly: 0,
      expired: 0,
      unavailable: 0,
    };
    // Un par un : pas de rafale vers le prestataire.
    for (const payment of pending) {
      counts[await this.reconcile(payment)] += 1;
    }
    return { examined: pending.length, ...counts };
  }

  private async reconcile(
    payment: Payment,
  ): Promise<SettlementOutcome | 'expired' | 'unavailable'> {
    const settled = await this.settler.settle(payment, ConfirmationChannel.SWEEP);
    if (settled.isErr()) return 'unavailable';
    if (settled.value !== 'waiting' || !isExpiryDue(payment, this.clock.now())) {
      return settled.value;
    }
    const expired = await this.payments.complete(
      payment.id,
      PaymentStatus.PENDING,
      {
        status: PaymentStatus.EXPIRED,
        failureCode:
          payment.providerReference === null ? PaymentFailureCode.NO_PROVIDER_REFERENCE : null,
      },
      this.clock.now(),
    );
    return expired ? 'expired' : 'raced';
  }
}
