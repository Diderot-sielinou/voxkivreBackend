/** File BullMQ du module document (ADR-0009). */
export const DOCUMENT_QUEUE = 'document';

export const EXTRACT_TEXT_JOB = 'extract-text';

/** Essais de l'extraction : pannes transitoires (stockage, base) uniquement. */
export const EXTRACT_TEXT_ATTEMPTS = 3;

/**
 * `jobId` déterministe : un document = une extraction. BullMQ ignore un
 * `add` dont l'id existe déjà — c'est ce qui rend le rattrapage sûr.
 */
export function extractTextJobId(documentId: string): string {
  return `${EXTRACT_TEXT_JOB}-${documentId}`;
}
