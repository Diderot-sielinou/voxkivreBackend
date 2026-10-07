/**
 * Caractères visés par partie (ADR-0011), au débit d'une voix WaveNet
 * (~15 caractères par seconde) : la première est courte pour servir
 * d'aperçu (RF-15), les suivantes font ~10 minutes.
 */
export const FIRST_PART_TARGET_CHARS = 1800;
export const PART_TARGET_CHARS = 9000;

export interface PlannedPart {
  readonly index: number;
  readonly firstSegment: number;
  readonly lastSegment: number;
}

/**
 * Regroupe des segments consécutifs en parties : une partie se ferme dès
 * qu'elle atteint sa cible, toujours sur une frontière de segment. Pur et
 * déterministe : ne dépend que des caractères, connus dès la préparation.
 */
export function planParts(segments: readonly { readonly charCount: number }[]): PlannedPart[] {
  const parts: PlannedPart[] = [];
  let first = 0;
  let chars = 0;
  for (const [index, segment] of segments.entries()) {
    chars += segment.charCount;
    const target = parts.length === 0 ? FIRST_PART_TARGET_CHARS : PART_TARGET_CHARS;
    if (chars >= target || index === segments.length - 1) {
      parts.push({ index: parts.length, firstSegment: first, lastSegment: index });
      first = index + 1;
      chars = 0;
    }
  }
  return parts;
}
