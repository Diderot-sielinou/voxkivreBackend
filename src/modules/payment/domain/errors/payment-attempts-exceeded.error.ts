import { DomainError } from '@/shared/kernel';

import { PAYMENT_ERROR_CODES } from './error-codes';

/** Trop de tentatives pour ce compte ou ce numéro (ADR-0021 §10). */
export class PaymentAttemptsExceededError extends DomainError {
  readonly code = PAYMENT_ERROR_CODES.RATE_LIMIT_PAYMENT_ATTEMPTS;
}
