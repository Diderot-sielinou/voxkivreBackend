import { createHmac, timingSafeEqual } from 'node:crypto';

import { InvalidCursorError } from './errors';
import { Result } from './result';

/** Version du format de cursor — incrémentée sur changement breaking du payload. */
const CURSOR_VERSION = 1;

export interface CursorPage<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
}

export interface CursorEncoder<TSort> {
  encode(sort: TSort, id: string): string;
  decode(token: string): Result<{ sort: TSort; id: string }, InvalidCursorError>;
}

/**
 * Codec de pagination par cursor signé HMAC-SHA256 (cf. ADR-0007).
 *
 * Pourquoi cursor et pas OFFSET : OFFSET dégrade linéairement et saute des
 * lignes quand la liste bouge (bibliothèque mise à jour pendant le scroll).
 * Pourquoi signé : un cursor altéré côté client doit être rejeté avec un
 * code stable `INVALID_CURSOR` (422) et non produire un SQL bizarre.
 *
 * Format opaque : `<base64url(payload)>.<base64url(hmac)>` avec
 * `payload = { s: sort, i: id, v: 1 }`. Le kernel n'exporte que la factory
 * pure — le secret est injecté par le module Nest consommateur.
 */
export function createCursorCodec<TSort>(secret: string): CursorEncoder<TSort> {
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new Error('createCursorCodec: secret must be a string of at least 32 chars');
  }

  return {
    encode(sort, id) {
      const payloadB64 = toBase64Url(
        Buffer.from(JSON.stringify({ s: sort, i: id, v: CURSOR_VERSION }), 'utf8'),
      );
      const sig = createHmac('sha256', secret).update(payloadB64).digest();
      return `${payloadB64}.${toBase64Url(sig)}`;
    },

    decode(token) {
      if (typeof token !== 'string' || token.length === 0) {
        return Result.err(new InvalidCursorError('Cursor must be a non-empty string'));
      }
      const dotIdx = token.indexOf('.');
      if (dotIdx === -1) {
        return Result.err(new InvalidCursorError('Cursor format invalid (expected payload.sig)'));
      }
      const payloadB64 = token.slice(0, dotIdx);
      const sigB64 = token.slice(dotIdx + 1);
      if (payloadB64.length === 0 || sigB64.length === 0) {
        return Result.err(new InvalidCursorError('Cursor payload or signature empty'));
      }

      const providedSig = fromBase64Url(sigB64);
      const expectedSig = createHmac('sha256', secret).update(payloadB64).digest();
      if (providedSig.length !== expectedSig.length || !timingSafeEqual(providedSig, expectedSig)) {
        return Result.err(new InvalidCursorError('Cursor signature mismatch'));
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(fromBase64Url(payloadB64).toString('utf8'));
      } catch {
        return Result.err(new InvalidCursorError('Cursor payload is not valid JSON'));
      }
      if (typeof parsed !== 'object' || parsed === null) {
        return Result.err(new InvalidCursorError('Cursor payload must be an object'));
      }
      const obj = parsed as { s?: unknown; i?: unknown; v?: unknown };
      if (obj.v !== CURSOR_VERSION) {
        return Result.err(
          new InvalidCursorError(
            `Cursor version ${String(obj.v)} not supported (expected ${String(CURSOR_VERSION)})`,
          ),
        );
      }
      if (typeof obj.i !== 'string') {
        return Result.err(new InvalidCursorError('Cursor `id` must be a string'));
      }
      return Result.ok({ sort: obj.s as TSort, id: obj.i });
    },
  };
}

/**
 * Helper de fin de query : étant donné `limit + 1` rangées fetchées, découpe
 * à `limit` et calcule `nextCursor` depuis la dernière rangée retenue.
 *
 * @example
 * const rows = await db.select(...).limit(limit + 1);
 * return buildPage(rows, limit, (r) => ({ sort: r.createdAt, id: r.id }), codec.encode);
 */
export function buildPage<T, TSort>(
  rows: readonly T[],
  limit: number,
  keyOf: (row: T) => { sort: TSort; id: string },
  encode: (sort: TSort, id: string) => string,
): CursorPage<T> {
  if (limit <= 0) {
    return { items: [], nextCursor: null };
  }
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  if (rows.length <= limit || last === undefined) {
    return { items, nextCursor: null };
  }
  const { sort, id } = keyOf(last);
  return { items, nextCursor: encode(sort, id) };
}

function toBase64Url(buf: Buffer): string {
  return buf.toString('base64url');
}

function fromBase64Url(s: string): Buffer {
  return Buffer.from(s, 'base64url');
}
