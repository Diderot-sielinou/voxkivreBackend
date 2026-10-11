import { DomainError } from '@/shared/kernel';

import { PAYMENT_ERROR_CODES } from './error-codes';

/** Un paiement récent attend encore la confirmation sur le téléphone (ADR-0021 §10). */
export class PaymentInProgressError extends DomainError {
  readonly code = PAYMENT_ERROR_CODES.PAYMENT_IN_PROGRESS_CONFLICT;

  constructor(paymentId: string) {
    super('A payment is already awaiting confirmation', { details: { paymentId } });
  }
}
