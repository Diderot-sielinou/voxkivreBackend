/**
 * Cycle de vie d'une conversion (un texte, une voix) :
 *
 * ```
 * queued → preparing → synthesizing → synthesized   (2c : → ready)
 *    └─────────┴────────────┴──────→ failed (+ remboursement du quota)
 * ```
 */
export const ConversionStatus = {
  /** Créée, quota réservé ; préparation en file d'attente. */
  QUEUED: 'queued',
  /** Découpage du texte en segments SSML (worker). */
  PREPARING: 'preparing',
  /** Segments en cours de synthèse (`segmentsDone` / `segmentCount`). */
  SYNTHESIZING: 'synthesizing',
  /** Tous les segments ont leur audio et leurs horodatages. */
  SYNTHESIZED: 'synthesized',
  /** Échec définitif (`failureReason`) ; la part non consommée est remboursée. */
  FAILED: 'failed',
} as const;

export type ConversionStatus = (typeof ConversionStatus)[keyof typeof ConversionStatus];

/** Statuts où la conversion peut encore échouer (donc être remboursée). */
export const IN_PROGRESS_STATUSES: readonly ConversionStatus[] = [
  ConversionStatus.QUEUED,
  ConversionStatus.PREPARING,
  ConversionStatus.SYNTHESIZING,
];

/**
 * Raison stable d'un échec (le mobile branche son message dessus) :
 * - `text_changed`       : texte corrigé entre le lancement et la préparation — relancer ;
 * - `source_unavailable` : document supprimé ou texte plus disponible ;
 * - `empty_text`         : aucun mot à lire ;
 * - `tts_rejected`       : le moteur a refusé la requête (définitif) ;
 * - `internal`           : échec technique après tous les essais (RNF-11).
 */
export const ConversionFailureReason = {
  TEXT_CHANGED: 'text_changed',
  SOURCE_UNAVAILABLE: 'source_unavailable',
  EMPTY_TEXT: 'empty_text',
  TTS_REJECTED: 'tts_rejected',
  INTERNAL: 'internal',
} as const;

export type ConversionFailureReason =
  (typeof ConversionFailureReason)[keyof typeof ConversionFailureReason];
