import { createHash, randomBytes } from 'node:crypto';

/**
 * Génère un UUID v7 (RFC 9562).
 *
 * Pourquoi v7 plutôt que v4 : préfixe timestamp (48 bits ms) → ordre
 * temporel naturel des IDs, meilleure localité d'index B-Tree Postgres,
 * tri par création sans index supplémentaire. 74 bits aléatoires restants.
 */
export function uuidV7(): string {
  const bytes = randomBytes(16);
  const now = BigInt(Date.now());

  // 48 bits de timestamp ms sur les bytes 0..5
  bytes[0] = Number((now >> 40n) & 0xffn);
  bytes[1] = Number((now >> 32n) & 0xffn);
  bytes[2] = Number((now >> 24n) & 0xffn);
  bytes[3] = Number((now >> 16n) & 0xffn);
  bytes[4] = Number((now >> 8n) & 0xffn);
  bytes[5] = Number(now & 0xffn);

  // Version 7 sur le nibble haut du byte 6
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  // Variant RFC 4122 (`10xx`) sur le nibble haut du byte 8
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  return formatUuid(bytes);
}

function formatUuid(bytes: Buffer): string {
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** `true` si la string est un UUID v1-v8 bien formé. */
export function isUuid(value: string): boolean {
  return typeof value === 'string' && UUID_REGEX.test(value);
}

/**
 * UUID v5 (RFC 4122) — déterministe : même `(namespace, name)` → même UUID.
 *
 * Usage Voxlivre : IDs stables pour des référentiels seedés (voix TTS,
 * plans tarifaires) et clés de cache de conversion (empreinte texte + voix
 * + paramètres, cf. RNF-26).
 */
export function uuidV5(name: string, namespace: string): string {
  if (!isUuid(namespace)) {
    throw new TypeError(`uuidV5: namespace must be a valid UUID (got "${namespace}")`);
  }

  const namespaceBytes = Buffer.from(namespace.replaceAll('-', ''), 'hex');
  const nameBytes = Buffer.from(name, 'utf8');

  // SHA-1 imposé par RFC 4122 § 4.3 pour v5. Pas un contexte sécurité —
  // c'est un hash d'identité déterministe.
  // eslint-disable-next-line sonarjs/hashing
  const digest = createHash('sha1').update(namespaceBytes).update(nameBytes).digest();

  const bytes = Buffer.alloc(16);
  digest.copy(bytes, 0, 0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  return formatUuid(bytes);
}

/** Namespaces UUID prédéfinis (RFC 4122 Appendix C). */
export const UUID_NAMESPACES = {
  DNS: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
  URL: '6ba7b811-9dad-11d1-80b4-00c04fd430c8',
  OID: '6ba7b812-9dad-11d1-80b4-00c04fd430c8',
  X500: '6ba7b814-9dad-11d1-80b4-00c04fd430c8',
} as const;
