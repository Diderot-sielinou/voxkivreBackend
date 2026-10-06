import { DomainError } from '@/shared/kernel';

import { DOCUMENT_ERROR_CODES } from './error-codes';

export class DocumentPageNotFoundError extends DomainError {
  readonly code = DOCUMENT_ERROR_CODES.DOCUMENT_PAGE_NOT_FOUND;

  constructor(documentId: string, pageNumber: number) {
    super(`Page ${String(pageNumber)} of document ${documentId} not found`, {
      details: { documentId, pageNumber },
    });
  }
}
