import { createHmac, timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

const header = z.object({ alg: z.literal('HS256') }).loose();
const claims = z.object({ exp: z.number().optional(), nbf: z.number().optional() }).loose();

/**
 * Vérifie un JWT HS256 (ADR-0021 §3) sans dépendance : en-tête `alg`
 * **imposé** (un jeton `none` ou RS256 est refusé, pas « adapté »),
 * signature comparée en temps constant, `exp` et `nbf` respectés s'ils sont
 * présents. Renvoie `false` pour tout jeton illisible : l'appelant n'a pas
 * à distinguer les raisons, et n'en dit rien à l'émetteur.
 *
 * Le contenu du jeton n'est pas lu : chez Campay il ne dit pas à quelle
 * transaction il se rapporte, l'état est relu de toute façon.
 */
export function isValidHs256Jwt(token: string, key: string, nowSeconds: number): boolean {
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [encodedHeader, encodedClaims, encodedSignature] = parts;

  const expected = createHmac('sha256', key).update(`${encodedHeader}.${encodedClaims}`).digest();
  const received = Buffer.from(encodedSignature, 'base64url');
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return false;

  const parsedHeader = header.safeParse(decodeJson(encodedHeader));
  const parsedClaims = claims.safeParse(decodeJson(encodedClaims));
  if (!parsedHeader.success || !parsedClaims.success) return false;

  const { exp, nbf } = parsedClaims.data;
  if (exp !== undefined && nowSeconds >= exp) return false;
  if (nbf !== undefined && nowSeconds < nbf) return false;
  return true;
}

function decodeJson(segment: string): unknown {
  try {
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
  } catch {
    // Segment qui n'est pas du JSON : jeton refusé par le schéma.
    return null;
  }
}
