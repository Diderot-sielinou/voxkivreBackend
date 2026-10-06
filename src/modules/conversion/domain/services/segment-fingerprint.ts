import { createHash } from 'node:crypto';

/**
 * Empreinte d'un segment pour le cache audio (RNF-26) : SHA-256 de la
 * signature du moteur (fournisseur, voix, format, vitesse) et du SSML. Même
 * empreinte = même audio, quel que soit l'utilisateur ou la conversion.
 */
export function segmentFingerprint(engineSignature: string, ssml: string): string {
  return createHash('sha256').update(engineSignature).update('\n').update(ssml).digest('hex');
}

/** Clés du cache dans le stockage objet : déterministes, une relance réécrit au lieu de dupliquer. */
export function cacheKeysFor(fingerprint: string): {
  readonly audio: string;
  readonly marks: string;
} {
  return {
    audio: `tts-cache/${fingerprint}.mp3`,
    marks: `tts-cache/${fingerprint}.json`,
  };
}
