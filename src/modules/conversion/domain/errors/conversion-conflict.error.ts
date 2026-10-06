import { DomainError } from '@/shared/kernel';

import { CONVERSION_ERROR_CODES } from './error-codes';

/**
 * Levée par le repository quand l'index unique « une conversion active par
 * (document, voix, révision) » refuse l'insertion : un lancement identique
 * vient de gagner la course. Elle annule la transaction (réservation de
 * quota comprise) ; le use-case renvoie alors la conversion gagnante.
 */
export class ConversionConflictError extends DomainError {
  readonly code = CONVERSION_ERROR_CODES.CONVERSION_CONFLICT;
}
