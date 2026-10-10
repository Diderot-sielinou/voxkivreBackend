import { DomainError } from '@/shared/kernel';

import { LIBRARY_ERROR_CODES } from './error-codes';

/** Absent **ou à un autre utilisateur** : même 404, rien n'est révélé (RNF-08). */
export class DocumentNotFoundError extends DomainError {
  readonly code = LIBRARY_ERROR_CODES.DOCUMENT_NOT_FOUND;

  constructor(documentId: string) {
    super(`Document ${documentId} not found`, { details: { documentId } });
  }
}
