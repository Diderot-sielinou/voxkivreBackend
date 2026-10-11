import { DomainError } from '@/shared/kernel';

import { PAYMENT_ERROR_CODES } from './error-codes';

/** Notification dont la signature ne se vérifie pas : rien n'est lu (ADR-0021 §3). */
export class InvalidPaymentNotificationError extends DomainError {
  readonly code = PAYMENT_ERROR_CODES.UNAUTHORIZED_PAYMENT_NOTIFICATION;
}
