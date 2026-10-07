import { type SynthesisMark } from '../ports/tts.port';

/**
 * Un audio de synthèse est complet si son dernier mot **commence avant la
 * fin** de l'audio. Les horodatages viennent d'une source indépendante de
 * l'audio (requête séparée chez Polly) : un audio tronqué en route — vu à
 * l'essai réel, flux HTTP/2 coupé à 10,92 s sans erreur — est ainsi détecté
 * avant d'être payé deux fois, mis en cache ou livré (ADR-0013).
 */
export function isAudioComplete(
  marks: readonly Pick<SynthesisMark, 'timeSeconds'>[],
  durationMs: number,
): boolean {
  if (durationMs <= 0) return false;
  const last = marks.reduce((max, mark) => Math.max(max, mark.timeSeconds), 0);
  return last * 1000 < durationMs;
}
