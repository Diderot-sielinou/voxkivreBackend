import { createHash } from 'node:crypto';

import { type Brand } from './branded';
import { InvalidIdempotencyKeyError } from './errors';
import { Result } from './result';
import { isUuid, uuidV7 } from './uuid';

/**
 * Clé d'idempotence universelle.
 *
 * Voxlivre en a besoin sur toute mutation "coûteuse ou financière" :
 * lancement d'une conversion (coût TTS), webhooks Mobile Money (RNF-09 :
 * une notification ne doit jamais être comptabilisée deux fois), débit de
 * quota. Le kernel n'embarque **aucun stockage** — la déduplication est
 * implémentée par les modules concernés (table `idempotency_keys` ou Redis).
 */
export type IdempotencyKey = Brand<string, 'IdempotencyKey'>;

const MAX_KEY_LENGTH = 128;
const MIN_KEY_LENGTH = 8;
const KEY_PATTERN = /^[A-Za-z0-9_-]+$/;

export const IdempotencyKey = {
  /**
   * Construit une `IdempotencyKey` depuis une string brute : tout UUID bien
   * formé OU toute string de 8..128 caractères parmi `A-Za-z0-9_-`.
   */
  of(raw: string): Result<IdempotencyKey, InvalidIdempotencyKeyError> {
    if (typeof raw !== 'string' || raw.length === 0) {
      return Result.err(
        new InvalidIdempotencyKeyError('Idempotency key must be a non-empty string'),
      );
    }
    const trimmed = raw.trim();
    if (trimmed.length < MIN_KEY_LENGTH || trimmed.length > MAX_KEY_LENGTH) {
      return Result.err(
        new InvalidIdempotencyKeyError(
          `Idempotency key length must be ${String(MIN_KEY_LENGTH)}..${String(MAX_KEY_LENGTH)} (got ${String(trimmed.length)})`,
          { details: { length: trimmed.length } },
        ),
      );
    }
    if (!KEY_PATTERN.test(trimmed) && !isUuid(trimmed)) {
      return Result.err(
        new InvalidIdempotencyKeyError(
          'Idempotency key contains invalid characters (allowed: A-Za-z0-9_- or UUID)',
        ),
      );
    }
    return Result.ok(trimmed as IdempotencyKey);
  },

  /** Génère une nouvelle clé (UUID v7). */
  generate(): IdempotencyKey {
    return uuidV7() as IdempotencyKey;
  },
} as const;

/**
 * Hash SHA-256 stable d'un payload arbitraire (canonical JSON : clés triées
 * récursivement). Sert à distinguer "même clé + même body" (replay → réponse
 * cachée) de "même clé + body différent" (suspect → 409 Conflict).
 */
export function idempotencyHashOf(payload: unknown): string {
  return createHash('sha256').update(canonicalize(payload)).digest('hex');
}

function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'bigint') return `bigint:${value.toString()}`;
  if (typeof value === 'number') return `number:${String(value)}`;
  if (typeof value === 'boolean') return `bool:${String(value)}`;
  if (typeof value === 'string') return `string:${JSON.stringify(value)}`;
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalize(v)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    // Tri par code-point (déterministe cross-runtime), pas `localeCompare`.
    // eslint-disable-next-line sonarjs/no-alphabetical-sort
    const keys = Object.keys(obj).toSorted();
    const entries = keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`);
    return `{${entries.join(',')}}`;
  }
  return `unsupported:${typeof value}`;
}
