import { DomainError } from '@/shared/kernel';

import { CONVERSION_ERROR_CODES } from './error-codes';

/** Panne transitoire du moteur TTS : la tâche est réessayée (RNF-11 : 503 si exposée). */
export class TtsUnavailableError extends DomainError {
  readonly code = CONVERSION_ERROR_CODES.TTS_UNAVAILABLE;
}

/** Le moteur refuse définitivement la requête : la conversion échoue (`tts_rejected`). */
export class TtsRequestRejectedError extends DomainError {
  readonly code = CONVERSION_ERROR_CODES.TTS_REQUEST_REJECTED;
}
