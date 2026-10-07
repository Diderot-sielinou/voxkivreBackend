import { DomainError } from '@/shared/kernel';

import { CONVERSION_ERROR_CODES } from './error-codes';

/** Aucune partie assemblée pour l'instant (409, `details.status` = statut actuel). */
export class ConversionNotReadyError extends DomainError {
  readonly code = CONVERSION_ERROR_CODES.CONVERSION_NOT_READY;

  constructor(conversionId: string, status: string) {
    super(`Conversion ${conversionId} has no playable part yet (status: ${status})`, {
      details: { conversionId, status },
    });
  }
}
