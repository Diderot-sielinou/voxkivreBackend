/**
 * Cycle de vie du **fichier** importé. L'avancement du pipeline (extraction,
 * validation, synthèse…) vivra dans `conversions` (SDD §7.1), pas ici :
 * un document peut avoir plusieurs conversions (autre voix, relance).
 */
export const DocumentStatus = {
  /** Créé, URL d'upload émise, fichier pas encore confirmé. */
  AWAITING_UPLOAD: 'awaiting_upload',
  /** Fichier reçu et vérifié (taille, signature PDF). */
  UPLOADED: 'uploaded',
} as const;

export type DocumentStatus = (typeof DocumentStatus)[keyof typeof DocumentStatus];
