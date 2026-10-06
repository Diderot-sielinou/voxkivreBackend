import { DomainError } from '@/shared/kernel';

import { BILLING_ERROR_CODES } from './error-codes';

/** Une conversion ne peut pas dépasser `maxChars` caractères, quel que soit le quota (RNF-25). */
export class ConversionLimitExceededError extends DomainError {
  readonly code = BILLING_ERROR_CODES.QUOTA_CONVERSION_LIMIT_EXCEEDED;

  constructor(details: { readonly requested: number; readonly maxChars: number }) {
    super(
      `A conversion is limited to ${String(details.maxChars)} characters (${String(details.requested)} requested)`,
      { details },
    );
  }
}
