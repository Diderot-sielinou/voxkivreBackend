import { DomainError } from '@/shared/kernel';

import { LIBRARY_ERROR_CODES } from './error-codes';

/** Raison stable (le mobile branche son comportement dessus). */
export const InvalidReadingPositionReason = {
  /** `wordIndex` au-delà des mots écoutables. */
  WORD_OUT_OF_RANGE: 'word_out_of_range',
  /** `audioMs` au-delà de la durée écoutable. */
  AUDIO_OUT_OF_RANGE: 'audio_out_of_range',
  /** `recordedAt` dans le futur au-delà de la tolérance de dérive d'horloge. */
  RECORDED_IN_FUTURE: 'recorded_in_future',
} as const;

export type InvalidReadingPositionReason =
  (typeof InvalidReadingPositionReason)[keyof typeof InvalidReadingPositionReason];

export class InvalidReadingPositionError extends DomainError {
  readonly code = LIBRARY_ERROR_CODES.INVALID_READING_POSITION;

  constructor(reason: InvalidReadingPositionReason, details: Record<string, number | string>) {
    super(`Invalid reading position (${reason})`, { details: { reason, ...details } });
  }
}
