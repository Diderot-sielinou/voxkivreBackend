export const DOCUMENT_TEXT_SOURCE = Symbol('DocumentTextSource');

/** Ce que la conversion doit savoir du texte d'un document (module `document`). */
export interface SourceText {
  readonly documentId: string;
  readonly ownerId: string;
  /** Le texte est extrait et consultable (statut `text_ready` du document). */
  readonly textReady: boolean;
  /** Statut du document, renvoyé tel quel au mobile quand le texte n'est pas prêt. */
  readonly status: string;
  readonly charCount: number;
  readonly textRevision: number;
}

export interface SourcePage {
  readonly pageNumber: number;
  readonly text: string;
}

/** Accès en lecture au texte des documents, implémenté par un adapter vers `DocumentModule`. */
export interface DocumentTextSourcePort {
  /** Filtré par propriétaire : `null` si absent ou à quelqu'un d'autre. */
  findForOwner(documentId: string, ownerId: string): Promise<SourceText | null>;
  /** Sans filtre propriétaire (workers). */
  findById(documentId: string): Promise<SourceText | null>;
  /** Toutes les pages, dans l'ordre. */
  readPages(documentId: string): Promise<readonly SourcePage[]>;
}
