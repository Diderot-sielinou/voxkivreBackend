/**
 * Statut d'un livre dans la bibliothèque (RF-17, ADR-0015) : **dérivé** du
 * document, de sa conversion retenue et de la position — jamais stocké.
 *
 * - `processing`    : extraction ou conversion en cours ;
 * - `failed`        : extraction ou conversion échouée ;
 * - `not_converted` : texte prêt, aucune conversion lancée ;
 * - `ready`         : écoutable, jamais commencé ;
 * - `in_progress`   : lecture commencée (« à reprendre ») ;
 * - `finished`      : conversion prête et moins de 2 % des mots restants.
 */
export const LibraryItemStatus = {
  PROCESSING: 'processing',
  FAILED: 'failed',
  NOT_CONVERTED: 'not_converted',
  READY: 'ready',
  IN_PROGRESS: 'in_progress',
  FINISHED: 'finished',
} as const;

export type LibraryItemStatus = (typeof LibraryItemStatus)[keyof typeof LibraryItemStatus];

/** État d'un document vu de la bibliothèque (traduit par l'adapter). */
export const DocumentState = {
  PROCESSING: 'processing',
  FAILED: 'failed',
  TEXT_READY: 'text_ready',
} as const;

export type DocumentState = (typeof DocumentState)[keyof typeof DocumentState];

/** État d'une conversion vu de la bibliothèque (traduit par l'adapter). */
export const ConversionState = {
  PROCESSING: 'processing',
  READY: 'ready',
  FAILED: 'failed',
} as const;

export type ConversionState = (typeof ConversionState)[keyof typeof ConversionState];
