import { DomainError } from '@/shared/kernel';

import { CONVERSION_ERROR_CODES } from './error-codes';

/** Document absent ou à un autre utilisateur (RNF-08), vu depuis la conversion. */
export class SourceDocumentNotFoundError extends DomainError {
  readonly code = CONVERSION_ERROR_CODES.DOCUMENT_NOT_FOUND;

  constructor(documentId: string) {
    super(`Document ${documentId} not found`, { details: { documentId } });
  }
}
