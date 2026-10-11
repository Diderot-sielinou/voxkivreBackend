import { DomainError } from '@/shared/kernel';

import { type AccountDeletionBlocker } from '../ports/account-activity.port';

import { IDENTITY_ERROR_CODES } from './error-codes';

/** Le compte a un travail en cours : supprimer après sa fin (ADR-0023 §1). */
export class AccountDeletionConflictError extends DomainError {
  readonly code = IDENTITY_ERROR_CODES.ACCOUNT_DELETION_CONFLICT;

  constructor(reason: AccountDeletionBlocker) {
    super(`Account cannot be deleted: ${reason}`, { details: { reason } });
  }
}
