import { HttpStatus } from '@nestjs/common';

/**
 * Codes qui ne suivent PAS la convention de suffixe/préfixe, avec leur
 * status. Table plutôt que chaîne de `if` : ces entrées n'ont pas de logique
 * commune, seulement un contrat client. Tout ce qui PEUT suivre la
 * convention (`*_NOT_FOUND`, `*_CONFLICT`, …) n'a rien à faire ici.
 */
const EXPLICIT_STATUS_BY_CODE: ReadonlyMap<string, HttpStatus> = new Map<string, HttpStatus>([
  // Ressource dans un état qui ne permet pas l'opération (texte pas encore
  // extrait, ou extraction échouée) : conflit d'état → 409.
  ['DOCUMENT_TEXT_NOT_READY', HttpStatus.CONFLICT],
  // Aucune partie de la conversion n'est encore écoutable (ADR-0011).
  ['CONVERSION_NOT_READY', HttpStatus.CONFLICT],
  // Quota mensuel épuisé : un abonnement ou des crédits le débloqueront (ADR-0010).
  ['QUOTA_EXCEEDED', HttpStatus.PAYMENT_REQUIRED],
  // Document au-delà du plafond par conversion (RNF-25) : payer n'y changerait rien.
  ['QUOTA_CONVERSION_LIMIT_EXCEEDED', HttpStatus.UNPROCESSABLE_ENTITY],
]);

/**
 * Mappe un `code` de `DomainError` vers un status HTTP.
 *
 * Convention (cf. `shared/kernel/error-codes.ts`) :
 * - `NOT_FOUND` / `*_NOT_FOUND`               → 404
 * - `CONFLICT` / `*_CONFLICT`                 → 409
 * - `*_PAYLOAD_TOO_LARGE`                     → 413
 * - `INVALID_*` / `VALIDATION_*`              → 422
 * - `UNAUTHORIZED*`                           → 401
 * - `FORBIDDEN*`                              → 403
 * - `RATE_LIMIT*`                             → 429
 * - `INFRASTRUCTURE_*`                        → 503
 * - défaut                                    → 500
 *
 * Pourquoi 422 et pas 400 : body syntaxiquement valide mais sémantiquement
 * invalide → 422 (RFC 4918). 400 reste réservé aux requêtes mal formées,
 * gérées par Nest (ValidationPipe) avant qu'une `DomainError` n'existe.
 */
export function statusFromCode(code: string): HttpStatus {
  const explicit = EXPLICIT_STATUS_BY_CODE.get(code);
  if (explicit !== undefined) return explicit;

  if (code === 'NOT_FOUND' || code.endsWith('_NOT_FOUND')) return HttpStatus.NOT_FOUND;
  if (code === 'CONFLICT' || code.endsWith('_CONFLICT')) return HttpStatus.CONFLICT;
  if (code === 'PAYLOAD_TOO_LARGE' || code.endsWith('_PAYLOAD_TOO_LARGE')) {
    return HttpStatus.PAYLOAD_TOO_LARGE;
  }
  if (code.startsWith('INVALID_') || code.startsWith('VALIDATION_')) {
    return HttpStatus.UNPROCESSABLE_ENTITY;
  }
  if (code.startsWith('UNAUTHORIZED')) return HttpStatus.UNAUTHORIZED;
  if (code.startsWith('FORBIDDEN')) return HttpStatus.FORBIDDEN;
  if (code.startsWith('RATE_LIMIT')) return HttpStatus.TOO_MANY_REQUESTS;
  if (code.startsWith('INFRASTRUCTURE_')) return HttpStatus.SERVICE_UNAVAILABLE;
  return HttpStatus.INTERNAL_SERVER_ERROR;
}

const TITLE_BY_STATUS: Readonly<Partial<Record<number, string>>> = {
  [HttpStatus.BAD_REQUEST]: 'Bad Request',
  [HttpStatus.UNAUTHORIZED]: 'Unauthorized',
  [HttpStatus.PAYMENT_REQUIRED]: 'Payment Required',
  [HttpStatus.FORBIDDEN]: 'Forbidden',
  [HttpStatus.NOT_FOUND]: 'Not Found',
  [HttpStatus.CONFLICT]: 'Conflict',
  [HttpStatus.PAYLOAD_TOO_LARGE]: 'Payload Too Large',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'Unprocessable Entity',
  [HttpStatus.TOO_MANY_REQUESTS]: 'Too Many Requests',
  [HttpStatus.INTERNAL_SERVER_ERROR]: 'Internal Server Error',
  [HttpStatus.SERVICE_UNAVAILABLE]: 'Service Unavailable',
};

export function titleFromStatus(status: HttpStatus): string {
  return TITLE_BY_STATUS[status] ?? 'Error';
}
