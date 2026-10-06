import { DomainError } from '@/shared/kernel';

import { type DocumentStatus } from '../value-objects/document-status.vo';

import { DOCUMENT_ERROR_CODES } from './error-codes';

/** Le texte n'est consultable/corrigible qu'en `text_ready` (`details.status` = statut actuel). */
export class DocumentTextNotReadyError extends DomainError {
  readonly code = DOCUMENT_ERROR_CODES.DOCUMENT_TEXT_NOT_READY;

  constructor(documentId: string, status: DocumentStatus) {
    super(`Text of document ${documentId} is not available (status: ${status})`, {
      details: { documentId, status },
    });
  }
}
