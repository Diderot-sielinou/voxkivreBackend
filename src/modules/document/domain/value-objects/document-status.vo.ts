/**
 * Cycle de vie de la **source** du livre : le fichier importé, puis le texte
 * qui en est extrait. L'audio (une conversion par voix) vivra dans
 * `conversions` (SDD §7.1) — un même texte peut être converti plusieurs fois.
 *
 * ```
 * awaiting_upload → uploaded → extracting → text_ready
 *                                  └──────→ extraction_failed
 * ```
 */
export const DocumentStatus = {
  /** Créé, URL d'upload émise, fichier pas encore confirmé. */
  AWAITING_UPLOAD: 'awaiting_upload',
  /** Fichier reçu et vérifié ; extraction en file d'attente. */
  UPLOADED: 'uploaded',
  /** Extraction du texte en cours (worker). */
  EXTRACTING: 'extracting',
  /** Texte extrait, consultable et corrigible ; PDF supprimé. */
  TEXT_READY: 'text_ready',
  /** Extraction impossible (`extractionError` dit pourquoi) ; PDF supprimé. */
  EXTRACTION_FAILED: 'extraction_failed',
} as const;

export type DocumentStatus = (typeof DocumentStatus)[keyof typeof DocumentStatus];

/**
 * Raison stable d'un échec d'extraction (le mobile branche son message dessus) :
 * - `scanned`            : PDF image sans couche texte, avant l'OCR (anciens
 *                          documents seulement, ADR-0024) ;
 * - `empty`              : aucune page ;
 * - `unreadable`         : PDF corrompu ou protégé par mot de passe ;
 * - `source_missing`     : fichier introuvable dans le stockage ;
 * - `internal`           : échec technique après tous les essais (RNF-11) ;
 * - `ocr_too_many_pages` : scan au-delà du plafond de pages (ADR-0024) ;
 * - `ocr_quota_exceeded` : plafond mensuel d'OCR d'un compte gratuit atteint ;
 * - `ocr_no_text`        : l'OCR n'a reconnu aucun mot.
 */
export const ExtractionFailureReason = {
  SCANNED: 'scanned',
  EMPTY: 'empty',
  UNREADABLE: 'unreadable',
  SOURCE_MISSING: 'source_missing',
  INTERNAL: 'internal',
  OCR_TOO_MANY_PAGES: 'ocr_too_many_pages',
  OCR_QUOTA_EXCEEDED: 'ocr_quota_exceeded',
  OCR_NO_TEXT: 'ocr_no_text',
} as const;

export type ExtractionFailureReason =
  (typeof ExtractionFailureReason)[keyof typeof ExtractionFailureReason];

/**
 * D'où vient le texte (ADR-0024) : la couche texte du PDF, ou l'OCR d'un
 * scan. `null` tant que l'extraction n'a pas tranché.
 */
export const ExtractionMethod = {
  NATIVE: 'native',
  OCR: 'ocr',
} as const;

export type ExtractionMethod = (typeof ExtractionMethod)[keyof typeof ExtractionMethod];
