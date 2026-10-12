import { DomainError } from '@/shared/kernel';

import { CONVERSION_ERROR_CODES } from './error-codes';

/**
 * Le texte d'un scan a une confiance OCR faible et n'a pas été relu (RF-06,
 * ADR-0024) : 409 tant que `POST /v1/documents/:id/review` n'a pas été fait.
 */
export class SourceTextReviewRequiredError extends DomainError {
  readonly code = CONVERSION_ERROR_CODES.DOCUMENT_REVIEW_REQUIRED;

  constructor(documentId: string) {
    super(`Text of document ${documentId} must be reviewed before conversion`, {
      details: { documentId },
    });
  }
}
