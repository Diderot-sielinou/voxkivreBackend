import { DomainError } from '@/shared/kernel';

import { LIBRARY_ERROR_CODES } from './error-codes';

/** Lecture jamais commencée, ou conversion absente / à un autre utilisateur (RNF-08). */
export class ReadingPositionNotFoundError extends DomainError {
  readonly code = LIBRARY_ERROR_CODES.READING_POSITION_NOT_FOUND;

  constructor(conversionId: string) {
    super(`No reading position for conversion ${conversionId}`, { details: { conversionId } });
  }
}
