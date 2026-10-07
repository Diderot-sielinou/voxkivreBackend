/** Files BullMQ de la conversion (ADR-0009) : une par étape, chacune sa concurrence. */
export const CONVERSION_PREPARE_QUEUE = 'conversion-prepare';
export const CONVERSION_SYNTHESIS_QUEUE = 'conversion-synthesis';
export const CONVERSION_ASSEMBLY_QUEUE = 'conversion-assembly';

export const PREPARE_CONVERSION_JOB = 'prepare-conversion';
export const SYNTHESIZE_SEGMENT_JOB = 'synthesize-segment';
export const ASSEMBLE_PART_JOB = 'assemble-part';

/** Pannes transitoires (base, file) uniquement. */
export const PREPARE_CONVERSION_ATTEMPTS = 3;
/**
 * Le fournisseur TTS a des 5xx/429 transitoires (jobs-and-pipeline.md) :
 * 5 essais à 5, 10, 20, 40 s — au-delà, la conversion échoue et est remboursée.
 */
export const SYNTHESIZE_SEGMENT_ATTEMPTS = 5;
/** Pannes de stockage transitoires ; au-delà, le balayage relance (ADR-0011). */
export const ASSEMBLE_PART_ATTEMPTS = 3;

/**
 * Plus grande priorité BullMQ (2²¹). Priorité = index du segment + 1 : les
 * premiers segments de **chaque** conversion passent avant la suite des
 * autres — l'aperçu (RF-15) arrive vite pour tout le monde.
 */
export const MAX_JOB_PRIORITY = 2_097_152;

export function prepareConversionJobId(conversionId: string): string {
  return `${PREPARE_CONVERSION_JOB}-${conversionId}`;
}

export function synthesizeSegmentJobId(conversionId: string, segmentIndex: number): string {
  return `${SYNTHESIZE_SEGMENT_JOB}-${conversionId}-${String(segmentIndex)}`;
}

/** Une partie = un assemblage ; `retryKey` (balayage) permet de relancer une tâche échouée. */
export function assemblePartJobId(
  conversionId: string,
  partIndex: number,
  retryKey?: string,
): string {
  const base = `${ASSEMBLE_PART_JOB}-${conversionId}-${String(partIndex)}`;
  return retryKey === undefined ? base : `${base}-${retryKey}`;
}
