/**
 * Base abstraite de toutes les erreurs métier.
 *
 * Toute erreur a un `code` stable (machine-readable) mappé vers un status
 * HTTP par le filter global (Problem Details RFC 7807, cf. `shared/http`).
 * `details` transporte un payload structuré pour le client (ex : quota
 * restant, longueur reçue) — jamais de donnée sensible.
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;

  readonly details?: Readonly<Record<string, unknown>>;

  constructor(message: string, options?: { cause?: unknown; details?: Record<string, unknown> }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = this.constructor.name;
    this.details = options?.details;
  }
}
