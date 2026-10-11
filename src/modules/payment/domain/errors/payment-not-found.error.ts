import { DomainError } from '@/shared/kernel';

import { PAYMENT_ERROR_CODES } from './error-codes';

/** Paiement inconnu, ou appartenant à un autre utilisateur : même réponse (RNF-08). */
export class PaymentNotFoundError extends DomainError {
  readonly code = PAYMENT_ERROR_CODES.PAYMENT_NOT_FOUND;

  constructor() {
    super('Payment not found');
  }
}
