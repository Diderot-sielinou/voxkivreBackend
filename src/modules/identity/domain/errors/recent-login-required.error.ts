import { DomainError } from '@/shared/kernel';

import { IDENTITY_ERROR_CODES } from './error-codes';

/** Session trop ancienne pour une action irréversible : se reconnecter (ADR-0023 §2). */
export class RecentLoginRequiredError extends DomainError {
  readonly code = IDENTITY_ERROR_CODES.RECENT_LOGIN_REQUIRED;

  constructor(maxAgeSeconds: number) {
    super('A recent sign-in is required', { details: { maxAgeSeconds } });
  }
}
