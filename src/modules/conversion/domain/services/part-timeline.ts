import { type SegmentWord } from '../entities/conversion-segment.entity';

/** Mot placé dans une partie : instants en millisecondes depuis le début de la partie. */
export interface TimedWord {
  readonly index: number;
  readonly text: string;
  readonly page: number;
  readonly startMs: number;
  readonly endMs: number;
}

export interface TimelineSegment {
  readonly firstWordIndex: number;
  readonly words: readonly SegmentWord[];
  /** Début de chaque mot en secondes, relatif au segment ; `null` si la marque manque. */
  readonly timepoints: readonly (number | null)[];
  /** Durée réelle de l'audio du segment dans la partie (décompte des trames). */
  readonly durationMs: number;
}

/**
 * Débuts (ms) des mots d'un segment ; une marque manquante est interpolée
 * linéairement entre ses voisines connues (début et fin du segment à
 * défaut), et les débuts ne reculent jamais.
 */
function wordStarts(segment: TimelineSegment): number[] {
  const known = segment.words.map((_, i) => {
    // `at()` : un tableau d'horodatages plus court que les mots donne `undefined`.
    const seconds = segment.timepoints.at(i);
    return seconds === null || seconds === undefined ? null : Math.round(seconds * 1000);
  });
  const starts: number[] = [];
  for (let i = 0; i < known.length; i += 1) {
    const value = known[i];
    if (value !== null) {
      starts.push(value);
      continue;
    }
    let next = i + 1;
    while (next < known.length && known[next] === null) next += 1;
    const before = starts.at(-1) ?? 0;
    const after = known[next] ?? segment.durationMs;
    const gap = next - i + 1;
    starts.push(Math.round(before + (after - before) / gap));
  }
  for (let i = 1; i < starts.length; i += 1) starts[i] = Math.max(starts[i], starts[i - 1]);
  return starts;
}

/**
 * Frise des mots d'une partie (ADR-0011) : chaque segment est décalé de la
 * durée des segments qui le précèdent ; fin d'un mot = début du suivant,
 * fin du segment pour le dernier.
 */
export function buildPartTimeline(segments: readonly TimelineSegment[]): TimedWord[] {
  const words: TimedWord[] = [];
  let offset = 0;
  for (const segment of segments) {
    const starts = wordStarts(segment);
    for (const [i, word] of segment.words.entries()) {
      const startMs = offset + Math.min(starts[i], segment.durationMs);
      const endMs = offset + Math.min(starts.at(i + 1) ?? segment.durationMs, segment.durationMs);
      words.push({ index: segment.firstWordIndex + i, text: word.t, page: word.p, startMs, endMs });
    }
    offset += segment.durationMs;
  }
  return words;
}
