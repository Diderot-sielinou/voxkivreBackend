import { DomainError } from '@/shared/kernel';

import { DOCUMENT_ERROR_CODES } from './error-codes';

/**
 * Raison stable (le mobile branche son message dessus) :
 * - `missing`       : aucun fichier reçu par le stockage (upload pas fait ou pas fini) ;
 * - `size_mismatch` : taille reçue ≠ taille déclarée ;
 * - `not_pdf`       : le contenu ne commence pas par la signature `%PDF-`.
 */
export type InvalidUploadReason = 'missing' | 'size_mismatch' | 'not_pdf';

export class InvalidDocumentUploadError extends DomainError {
  readonly code = DOCUMENT_ERROR_CODES.INVALID_DOCUMENT_UPLOAD;

  constructor(documentId: string, reason: InvalidUploadReason) {
    super(`Uploaded file for document ${documentId} is not acceptable (${reason})`, {
      details: { documentId, reason },
    });
  }
}
