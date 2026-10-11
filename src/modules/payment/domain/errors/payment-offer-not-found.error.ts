import { DomainError } from '@/shared/kernel';

import { PAYMENT_ERROR_CODES } from './error-codes';

/** Offre inconnue **ou retirée** : elle ne se vend plus (ADR-0019 §7). */
export class PaymentOfferNotFoundError extends DomainError {
  readonly code = PAYMENT_ERROR_CODES.OFFER_NOT_FOUND;

  constructor(offerCode: string) {
    super(`Offer not found: ${offerCode}`, { details: { offerCode } });
  }
}
