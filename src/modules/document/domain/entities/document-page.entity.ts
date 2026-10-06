import { type DocumentId } from '../value-objects/document-id.vo';

/**
 * Texte d'une page, tel qu'extrait puis éventuellement corrigé par
 * l'utilisateur (RF-06). C'est la **seule** source du livre une fois le PDF
 * supprimé : la synthèse vocale lira ces pages.
 */
export interface DocumentPage {
  readonly documentId: DocumentId;
  /** 1-based, comme dans un lecteur PDF. */
  readonly pageNumber: number;
  readonly text: string;
  readonly charCount: number;
  readonly updatedAt: Date;
}
