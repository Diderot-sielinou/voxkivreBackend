import { DomainError } from '@/shared/kernel';

import { CONVERSION_ERROR_CODES } from './error-codes';

/** Voix hors de la liste blanche (RF-21) ; `details.voices` = identifiants acceptés. */
export class InvalidVoiceError extends DomainError {
  readonly code = CONVERSION_ERROR_CODES.INVALID_VOICE;

  constructor(voiceId: string, voices: readonly string[]) {
    super(`Unknown voice "${voiceId}"`, { details: { voiceId, voices } });
  }
}
