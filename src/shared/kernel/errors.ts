import { DomainError } from './domain-error';
import { ERROR_CODES, type ErrorCode } from './error-codes';

/**
 * Sous-classes concrètes de `DomainError` exposées par le kernel — erreurs
 * transverses réutilisables. Les modules métier étendent `DomainError` avec
 * leurs propres codes.
 */

/** Validation sémantique générique (Zod, refinements métier). */
export class ValidationError extends DomainError {
  readonly code: ErrorCode = ERROR_CODES.VALIDATION_FAILED;
}

/** Cursor de pagination rejeté (signature invalide, format altéré). */
export class InvalidCursorError extends DomainError {
  readonly code: ErrorCode = ERROR_CODES.INVALID_CURSOR;
}

/** Idempotency key rejetée par `IdempotencyKey.of(...)`. */
export class InvalidIdempotencyKeyError extends DomainError {
  readonly code: ErrorCode = ERROR_CODES.INVALID_IDEMPOTENCY_KEY;
}

/** Ressource introuvable — code générique. */
export class NotFoundError extends DomainError {
  readonly code: ErrorCode = ERROR_CODES.NOT_FOUND;
}

/** Conflit de ressource — code générique. */
export class ConflictError extends DomainError {
  readonly code: ErrorCode = ERROR_CODES.CONFLICT;
}

/** Non authentifié. */
export class UnauthorizedError extends DomainError {
  readonly code: ErrorCode = ERROR_CODES.UNAUTHORIZED;
}

/** Authentifié mais non autorisé. */
export class ForbiddenError extends DomainError {
  readonly code: ErrorCode = ERROR_CODES.FORBIDDEN;
}

/** Rate-limit dépassé. */
export class RateLimitExceededError extends DomainError {
  readonly code: ErrorCode = ERROR_CODES.RATE_LIMIT_EXCEEDED;
}

/**
 * Incident d'infrastructure (DB indisponible, Redis timeout, TTS 5xx, ...).
 * Mappé vers 503 et **jamais 500** : le 500 est réservé aux bugs imprévus,
 * le 503 signale au client (mobile) qu'un retry est légitime — cohérent
 * avec RNF-11 ("informer l'utilisateur clairement plutôt qu'échouer
 * silencieusement").
 */
export class InfrastructureError extends DomainError {
  readonly code: ErrorCode = ERROR_CODES.INFRASTRUCTURE_ERROR;
}
