import { DomainError } from '@/shared/kernel';

import { IDENTITY_ERROR_CODES } from './error-codes';

export class InvalidPhoneNumberError extends DomainError {
  readonly code = IDENTITY_ERROR_CODES.INVALID_PHONE_NUMBER;
}
