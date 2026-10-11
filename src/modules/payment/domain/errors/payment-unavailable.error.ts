import { DomainError } from '@/shared/kernel';

import { PAYMENT_ERROR_CODES } from './error-codes';

/** Prestataire injoignable ou réponse inexploitable : réessayer plus tard (RNF-11). */
export class PaymentUnavailableError extends DomainError {
  readonly code = PAYMENT_ERROR_CODES.PAYMENT_UNAVAILABLE;
}
