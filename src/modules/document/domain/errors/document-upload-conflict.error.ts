import { DomainError } from '@/shared/kernel';

import { DOCUMENT_ERROR_CODES } from './error-codes';

/**
 * 409 : le document n'attend pas d'envoi par morceaux (déjà confirmé, ou
 * importé en un seul `PUT`) — ADR-0029.
 */
export class DocumentUploadConflictError extends DomainError {
  readonly code = DOCUMENT_ERROR_CODES.DOCUMENT_UPLOAD_CONFLICT;

  constructor(documentId: string) {
    super(`Document ${documentId} is not awaiting a multipart upload`, {
      details: { documentId },
    });
  }
}
