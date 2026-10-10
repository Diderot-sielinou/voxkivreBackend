import { DomainError } from '@/shared/kernel';

import { LIBRARY_ERROR_CODES } from './error-codes';

/** Rien n'est encore écoutable : aucune position ne peut y être enregistrée. */
export class ConversionNotReadyError extends DomainError {
  readonly code = LIBRARY_ERROR_CODES.CONVERSION_NOT_READY;

  constructor(conversionId: string, status: string) {
    super(`Conversion ${conversionId} has nothing playable yet (status: ${status})`, {
      details: { conversionId, status },
    });
  }
}
