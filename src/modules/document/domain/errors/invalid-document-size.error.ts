import { DomainError } from '@/shared/kernel';

import { DOCUMENT_ERROR_CODES } from './error-codes';

/** Taille déclarée nulle, non entière ou au-delà du plafond (`details.maxSizeBytes`). */
export class InvalidDocumentSizeError extends DomainError {
  readonly code = DOCUMENT_ERROR_CODES.INVALID_DOCUMENT_SIZE;
}
