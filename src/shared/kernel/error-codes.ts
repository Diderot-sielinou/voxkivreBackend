/**
 * Catalogue central des codes d'erreur du kernel.
 *
 * Les modules métier déclarent leurs propres codes dans un `error-codes.ts`
 * local (`DOCUMENT_NOT_FOUND`, `QUOTA_EXCEEDED`, …). Ce fichier ne contient
 * que les codes transverses utilisés par `errors.ts`.
 *
 * Convention de routing HTTP (cf. `shared/http/error-status.ts`) :
 * - préfixe `INVALID_` / `VALIDATION_`      → 422 Unprocessable Entity
 * - code (ou suffixe) `NOT_FOUND`            → 404
 * - code (ou suffixe) `CONFLICT`             → 409
 * - préfixe `UNAUTHORIZED`                   → 401
 * - préfixe `FORBIDDEN`                      → 403
 * - préfixe `RATE_LIMIT`                     → 429
 * - suffixe `PAYLOAD_TOO_LARGE`              → 413
 * - préfixe `INFRASTRUCTURE_`                → 503
 * - défaut                                   → 500
 */
export const ERROR_CODES = {
  // 422 — validation sémantique
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  INVALID_CURSOR: 'INVALID_CURSOR',
  INVALID_IDEMPOTENCY_KEY: 'INVALID_IDEMPOTENCY_KEY',

  // 404 / 409 — génériques (les modules préfèrent leurs variantes préfixées)
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',

  // 401 / 403 / 429
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',

  // 503 — incidents d'infrastructure (DB down, Redis down, TTS timeout, ...)
  INFRASTRUCTURE_ERROR: 'INFRASTRUCTURE_ERROR',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
