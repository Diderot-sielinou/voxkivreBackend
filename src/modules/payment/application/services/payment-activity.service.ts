import { Inject, Injectable } from '@nestjs/common';

import {
  PAYMENT_REPOSITORY,
  type PaymentRepositoryPort,
} from '../../domain/ports/payment-repository.port';

/**
 * Paiements **pour les autres modules** (suppression du compte, ADR-0023) :
 * exporté par `PaymentModule`, consommé derrière un port du module appelant.
 */
@Injectable()
export class PaymentActivity {
  constructor(@Inject(PAYMENT_REPOSITORY) private readonly payments: PaymentRepositoryPort) {}

  /** Un paiement attend encore sa confirmation : l'argent peut encore être débité. */
  hasPending(userId: string, tx?: unknown): Promise<boolean> {
    return this.payments.hasPendingForUser(userId, tx);
  }
}
