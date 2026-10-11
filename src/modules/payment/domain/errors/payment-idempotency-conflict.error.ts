import { DomainError } from '@/shared/kernel';

import { PAYMENT_ERROR_CODES } from './error-codes';

/** Même `Idempotency-Key`, requête différente (api-design.md). */
export class PaymentIdempotencyConflictError extends DomainError {
  readonly code = PAYMENT_ERROR_CODES.PAYMENT_IDEMPOTENCY_CONFLICT;

  constructor() {
    super('Idempotency key already used for a different payment request');
  }
}
