import { DomainError } from '@/shared/kernel';

import { PAYMENT_ERROR_CODES } from './error-codes';

/** Numéro hors mobiles camerounais, ou refusé par le prestataire (ADR-0021 §10). */
export class InvalidPaymentPhoneError extends DomainError {
  readonly code = PAYMENT_ERROR_CODES.INVALID_PAYMENT_PHONE;
}
