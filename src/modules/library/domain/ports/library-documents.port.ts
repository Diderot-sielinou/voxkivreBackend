import { type DocumentState } from '../value-objects/library-item-status.vo';

export const LIBRARY_DOCUMENTS = Symbol('LibraryDocuments');

/** Un document importé, vu de la bibliothèque (module `document`). */
export interface LibraryDocument {
  readonly documentId: string;
  readonly title: string;
  /** Statut brut du module document, renvoyé tel quel au mobile. */
  readonly status: string;
  readonly state: DocumentState;
  readonly pageCount: number | null;
  readonly charCount: number | null;
  readonly extractionError: string | null;
  readonly createdAt: Date;
}

/** Position de pagination : tri `(createdAt DESC, documentId DESC)`. */
export interface LibraryCursorPosition {
  readonly createdAt: Date;
  readonly documentId: string;
}

export interface DeletedLibraryDocument {
  readonly sourceKey: string;
  /** Le PDF source a déjà été effacé après l'extraction (CdC §8). */
  readonly sourceDeleted: boolean;
}

/** Accès aux documents, implémenté par un adapter vers `DocumentModule`. */
export interface LibraryDocumentsPort {
  /** Documents importés du propriétaire, du plus récent au plus ancien, après `after`. */
  listForOwner(
    ownerId: string,
    after: LibraryCursorPosition | null,
    limit: number,
  ): Promise<readonly LibraryDocument[]>;

  /** Filtré par propriétaire : `null` si absent ou à quelqu'un d'autre (RNF-08). */
  findForOwner(documentId: string, ownerId: string): Promise<LibraryDocument | null>;

  /** Supprime le document (cascade) dans la transaction `tx` ; `null` si absent. */
  deleteForOwner(
    documentId: string,
    ownerId: string,
    tx: unknown,
  ): Promise<DeletedLibraryDocument | null>;
}
