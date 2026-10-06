import { DomainError } from '@/shared/kernel';

import { DOCUMENT_ERROR_CODES } from './error-codes';

export class InvalidDocumentTitleError extends DomainError {
  readonly code = DOCUMENT_ERROR_CODES.INVALID_DOCUMENT_TITLE;
}
