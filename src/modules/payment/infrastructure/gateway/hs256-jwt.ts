import { createHmac, timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

const header = z.object({ alg: z.literal('HS256') }).loose();
const claims = z.object({ exp: z.number().optional(), nbf: z.number().optional() }).loose();

/**
 * Issue de la vérification d'un JWT. Les raisons d'un refus servent au
 * diagnostic dans nos journaux ; elles ne sont jamais renvoyées à l'émetteur.
 */
export type JwtCheck =
  | 'valid'
  /** Pas trois segments, ou en-tête / contenu illisibles. */
  | 'malformed'
  /** Empreinte HMAC différente : autre clé, ou jeton modifié. */
  | 'bad_signature'
  /** En-tête qui ne déclare pas HS256 (`none`, RS256…). */
  | 'unsupported_alg'
  | 'expired'
  | 'not_yet_valid';

/**
 * Vérifie un JWT HS256 (ADR-0021 §3) sans dépendance : en-tête `alg`
 * **imposé** (un jeton `none` ou RS256 est refusé, pas « adapté »),
 * signature comparée en temps constant, `exp` et `nbf` respectés s'ils sont
 * présents.
 *
 * Le contenu du jeton n'est pas lu : chez Campay il ne dit pas à quelle
 * transaction il se rapporte, l'état est relu de toute façon.
 */
export function checkHs256Jwt(token: string, key: string, nowSeconds: number): JwtCheck {
  const parts = token.split('.');
  if (parts.length !== 3) return 'malformed';
  const [encodedHeader, encodedClaims, encodedSignature] = parts;

  const expected = createHmac('sha256', key).update(`${encodedHeader}.${encodedClaims}`).digest();
  const received = Buffer.from(encodedSignature, 'base64url');
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    return 'bad_signature';
  }

  const decodedHeader = decodeJson(encodedHeader);
  const parsedClaims = claims.safeParse(decodeJson(encodedClaims));
  if (decodedHeader === null || !parsedClaims.success) return 'malformed';
  if (!header.safeParse(decodedHeader).success) return 'unsupported_alg';

  const { exp, nbf } = parsedClaims.data;
  if (exp !== undefined && nowSeconds >= exp) return 'expired';
  if (nbf !== undefined && nowSeconds < nbf) return 'not_yet_valid';
  return 'valid';
}

/** Raccourci : le jeton est-il accepté ? */
export function isValidHs256Jwt(token: string, key: string, nowSeconds: number): boolean {
  return checkHs256Jwt(token, key, nowSeconds) === 'valid';
}

function decodeJson(segment: string): unknown {
  try {
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
  } catch {
    // Segment qui n'est pas du JSON : jeton illisible.
    return null;
  }
}
