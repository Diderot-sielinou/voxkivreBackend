import { DomainError } from '@/shared/kernel';

import { CONVERSION_ERROR_CODES } from './error-codes';

export class InvalidConversionTextError extends DomainError {
  readonly code = CONVERSION_ERROR_CODES.INVALID_CONVERSION_TEXT;

  constructor(documentId: string) {
    super(`Document ${documentId} has no text to read`, { details: { documentId } });
  }
}
