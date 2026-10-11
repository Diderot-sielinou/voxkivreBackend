import { DomainError } from '@/shared/kernel';

import { BILLING_ERROR_CODES } from './error-codes';

export class OfferNotFoundError extends DomainError {
  readonly code = BILLING_ERROR_CODES.OFFER_NOT_FOUND;

  constructor(offerCode: string) {
    super(`Unknown offer "${offerCode}"`, { details: { offerCode } });
  }
}
