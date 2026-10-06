import { DomainError } from '@/shared/kernel';

import { DOCUMENT_ERROR_CODES } from './error-codes';

export class InvalidPageTextError extends DomainError {
  readonly code = DOCUMENT_ERROR_CODES.INVALID_PAGE_TEXT;
}
