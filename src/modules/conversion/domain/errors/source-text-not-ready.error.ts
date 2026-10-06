import { DomainError } from '@/shared/kernel';

import { CONVERSION_ERROR_CODES } from './error-codes';

/** Conversion possible seulement en `text_ready` (409, `details.status` = statut actuel). */
export class SourceTextNotReadyError extends DomainError {
  readonly code = CONVERSION_ERROR_CODES.DOCUMENT_TEXT_NOT_READY;

  constructor(documentId: string, status: string) {
    super(`Text of document ${documentId} is not ready (status: ${status})`, {
      details: { documentId, status },
    });
  }
}
