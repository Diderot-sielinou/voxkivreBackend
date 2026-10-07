import { type TimedWord } from './part-timeline';

/** Un repère WebVTT doit finir strictement après son début. */
const MIN_CUE_MS = 1;

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

function timestamp(ms: number): string {
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  const millis = ms % 1000;
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}.${pad(millis, 3)}`;
}

/** Échappements imposés par la spécification WebVTT dans le texte d'un repère. */
function escapeCueText(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/**
 * WebVTT d'une partie (RF-09, ADR-0011) : un repère par mot, identifié par
 * l'index global du mot — le mobile retrouve le mot dans son texte et le
 * surligne au bon instant (RF-10).
 */
export function buildWebVtt(words: readonly TimedWord[]): string {
  const cues = words.map((word) => {
    const end = Math.max(word.endMs, word.startMs + MIN_CUE_MS);
    return `${String(word.index)}\n${timestamp(word.startMs)} --> ${timestamp(end)}\n${escapeCueText(word.text)}\n`;
  });
  return ['WEBVTT\n', ...cues].join('\n');
}
