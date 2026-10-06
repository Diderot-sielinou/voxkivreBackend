import { DomainError } from '@/shared/kernel';

import { DOCUMENT_ERROR_CODES } from './error-codes';

/**
 * Document absent **ou appartenant à un autre utilisateur** : les deux cas
 * renvoient la même erreur (404), pour ne jamais révéler qu'un identifiant
 * existe chez quelqu'un d'autre (RNF-08).
 */
export class DocumentNotFoundError extends DomainError {
  readonly code = DOCUMENT_ERROR_CODES.DOCUMENT_NOT_FOUND;

  constructor(documentId: string) {
    super(`Document ${documentId} not found`, { details: { documentId } });
  }
}
