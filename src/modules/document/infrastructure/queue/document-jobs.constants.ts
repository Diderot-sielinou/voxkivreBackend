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

/**
 * File de l'OCR (ADR-0024), à part de `document` : une extraction native
 * (~1 s) n'attend pas derrière les lots d'un scan.
 */
export const DOCUMENT_OCR_QUEUE = 'document-ocr';

export const OCR_PAGES_JOB = 'ocr-pages';

/** Essais d'un lot : pannes transitoires (stockage, base, Tesseract tué). */
export const OCR_PAGES_ATTEMPTS = 3;

/** Un lot = une tâche ; `retryKey` (balayage) permet de relancer un lot déjà terminé. */
export function ocrPagesJobId(documentId: string, fromPage: number, retryKey?: string): string {
  const base = `${OCR_PAGES_JOB}-${documentId}-${String(fromPage)}`;
  return retryKey === undefined ? base : `${base}-${retryKey}`;
}
