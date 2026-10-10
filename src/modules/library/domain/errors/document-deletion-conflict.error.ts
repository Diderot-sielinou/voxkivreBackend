import { DomainError } from '@/shared/kernel';

import { LIBRARY_ERROR_CODES } from './error-codes';

/** Une conversion du document travaille encore : supprimer après sa fin (ADR-0016). */
export class DocumentDeletionConflictError extends DomainError {
  readonly code = LIBRARY_ERROR_CODES.DOCUMENT_DELETION_CONFLICT;

  constructor(documentId: string) {
    super(`Document ${documentId} has a conversion in progress`, { details: { documentId } });
  }
}
