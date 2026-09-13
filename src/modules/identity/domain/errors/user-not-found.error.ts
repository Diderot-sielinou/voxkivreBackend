import { DomainError } from '@/shared/kernel';

import { IDENTITY_ERROR_CODES } from './error-codes';

export class UserNotFoundError extends DomainError {
  readonly code = IDENTITY_ERROR_CODES.USER_NOT_FOUND;

  constructor(userId: string) {
    super(`User ${userId} not found`, { details: { userId } });
  }
}
