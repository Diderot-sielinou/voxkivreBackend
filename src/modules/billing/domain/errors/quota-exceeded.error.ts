import { DomainError } from '@/shared/kernel';

import { BILLING_ERROR_CODES } from './error-codes';

/**
 * Le quota du mois ne couvre pas la demande. `details` dit au mobile
 * combien il reste (`remaining`) et combien était demandé (`requested`).
 */
export class QuotaExceededError extends DomainError {
  readonly code = BILLING_ERROR_CODES.QUOTA_EXCEEDED;

  constructor(details: {
    readonly requested: number;
    readonly remaining: number;
    readonly limit: number;
    readonly period: string;
  }) {
    super(
      `Monthly character quota exceeded (${String(details.requested)} requested, ${String(details.remaining)} remaining)`,
      { details },
    );
  }
}
