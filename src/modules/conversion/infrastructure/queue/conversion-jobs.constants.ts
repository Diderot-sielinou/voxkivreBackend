/** Files BullMQ de la conversion (ADR-0009) : une par étape, chacune sa concurrence. */
export const CONVERSION_PREPARE_QUEUE = 'conversion-prepare';
export const CONVERSION_SYNTHESIS_QUEUE = 'conversion-synthesis';

export const PREPARE_CONVERSION_JOB = 'prepare-conversion';
export const SYNTHESIZE_SEGMENT_JOB = 'synthesize-segment';

/** Pannes transitoires (base, file) uniquement. */
export const PREPARE_CONVERSION_ATTEMPTS = 3;
/**
 * Le fournisseur TTS a des 5xx/429 transitoires (jobs-and-pipeline.md) :
 * 5 essais à 5, 10, 20, 40 s — au-delà, la conversion échoue et est remboursée.
 */
export const SYNTHESIZE_SEGMENT_ATTEMPTS = 5;

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
