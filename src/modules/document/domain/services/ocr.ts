import { ExtractionFailureReason } from '../value-objects/document-status.vo';

import { type ExtractedLine } from './text-cleaning';

/**
 * Règles de l'OCR des PDF scannés (RF-04, ADR-0024). Les chiffres viennent
 * du banc d'essai sur l'instance de production (~3,1 s/page) ; ils ne sont
 * pas réglables par l'environnement : les changer est une décision (ADR).
 */

/** Au-delà, un scan est refusé (~17 min d'OCR à lui seul). */
export const OCR_MAX_PAGES_PER_DOCUMENT = 300;

/** Pages d'OCR par mois civil UTC pour un compte sans pass ni crédits. */
export const OCR_FREE_PAGES_PER_MONTH = 200;

/** Pages par tâche (~35 s) : les scans en cours avancent à tour de rôle. */
export const OCR_BATCH_PAGES = 10;

/** Sous cette confiance sur une page, la relecture est imposée (RF-06). */
export const OCR_REVIEW_CONFIDENCE = 0.8;

/** Une page reconnue par l'OCR : ses lignes et la confiance moyenne de ses mots. */
export interface OcrPage {
  /** 1-based, comme dans un lecteur PDF. */
  readonly pageNumber: number;
  readonly lines: readonly ExtractedLine[];
  /** De 0 à 1 ; `null` si aucun mot n'a été reconnu sur la page. */
  readonly confidence: number | null;
}

/** Dernière page du lot qui commence à `fromPage`. */
export function ocrBatchEnd(fromPage: number, pageCount: number): number {
  return Math.min(fromPage + OCR_BATCH_PAGES - 1, pageCount);
}

/**
 * Première page absente de `done` (numéros déjà reconnus), ou `null` si
 * toutes les pages de 1 à `pageCount` le sont.
 */
export function firstMissingOcrPage(done: readonly number[], pageCount: number): number | null {
  const seen = new Set(done);
  for (let page = 1; page <= pageCount; page += 1) {
    if (!seen.has(page)) return page;
  }
  return null;
}

/** Début du mois civil UTC de `now` (même règle que le quota, ADR-0019). */
export function startOfOcrMonth(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * Le scan peut-il passer à l'OCR ? Le plafond de pages vaut pour tous ; le
 * plafond mensuel seulement pour un compte sans pass ni crédits. Un scan qui
 * dépasserait le reste du mois est refusé en entier (pas d'OCR partiel).
 */
export function checkOcrAllowance(input: {
  readonly pageCount: number;
  readonly pagesUsedThisMonth: number;
  readonly hasPaidAccess: boolean;
}): ExtractionFailureReason | null {
  if (input.pageCount > OCR_MAX_PAGES_PER_DOCUMENT) {
    return ExtractionFailureReason.OCR_TOO_MANY_PAGES;
  }
  if (
    !input.hasPaidAccess &&
    input.pagesUsedThisMonth + input.pageCount > OCR_FREE_PAGES_PER_MONTH
  ) {
    return ExtractionFailureReason.OCR_QUOTA_EXCEEDED;
  }
  return null;
}

/** La relecture est imposée si une page est sous le seuil de confiance. */
export function requiresReview(confidences: readonly (number | null)[]): boolean {
  return confidences.some(
    (confidence) => confidence !== null && confidence < OCR_REVIEW_CONFIDENCE,
  );
}
