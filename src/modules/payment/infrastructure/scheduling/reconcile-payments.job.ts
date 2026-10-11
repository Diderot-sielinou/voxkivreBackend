import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { ReconcilePendingPaymentsUseCase } from '../../application/use-cases/reconcile-pending-payments.use-case';

/**
 * Toutes les 5 minutes : relit chez le prestataire les paiements en attente
 * (RNF-13, ADR-0021 §9). Sans verrou entre instances : chaque transition est
 * conditionnelle, deux balayages simultanés ne concluent qu'une fois.
 */
@Injectable()
export class ReconcilePaymentsJob {
  private readonly logger = new Logger(ReconcilePaymentsJob.name);

  constructor(private readonly reconcile: ReconcilePendingPaymentsUseCase) {}

  @Cron('*/5 * * * *', { name: 'payment-reconcile-pending' })
  async run(): Promise<void> {
    try {
      const report = await this.reconcile.execute();
      if (report.examined === 0) return;
      // Bilan par issue : base du taux de réconciliation (RNF-27).
      this.logger.log({ ...report }, 'payment.reconciliation');
    } catch (error) {
      // Un cron qui throw est avalé par le scheduler : on logge nous-mêmes.
      this.logger.error({ err: error }, 'Payment reconciliation failed');
    }
  }
}
