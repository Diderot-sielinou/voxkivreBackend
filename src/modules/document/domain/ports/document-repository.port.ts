import { type DocumentPage } from '../entities/document-page.entity';
import { type Document } from '../entities/document.entity';
import { type PreparedPage } from '../services/extracted-text';
import { type DocumentId } from '../value-objects/document-id.vo';
import { type ExtractionFailureReason } from '../value-objects/document-status.vo';
import { type OwnerId } from '../value-objects/owner-id.vo';

export const DOCUMENT_REPOSITORY = Symbol('DocumentRepository');

/** Position de pagination : tri `(createdAt DESC, id DESC)`. */
export interface DocumentPagePosition {
  readonly createdAt: Date;
  readonly id: DocumentId;
}

export interface AbandonedUpload {
  readonly id: DocumentId;
  readonly sourceKey: string;
}

export interface DocumentRepositoryPort {
  insert(document: Document): Promise<void>;

  /** Filtre TOUJOURS sur le propriétaire : `null` si absent ou à quelqu'un d'autre (RNF-08). */
  findByIdForOwner(id: DocumentId, ownerId: OwnerId): Promise<Document | null>;

  /** Persiste la transition `awaiting_upload → uploaded` (sans effet si déjà faite). */
  markUploaded(id: DocumentId, uploadedAt: Date): Promise<void>;

  /**
   * Documents importés (tout statut sauf `awaiting_upload`) du propriétaire,
   * du plus récent au plus ancien, strictement après `after`. Au plus
   * `limit` lignes.
   */
  listImportedByOwner(
    ownerId: OwnerId,
    after: DocumentPagePosition | null,
    limit: number,
  ): Promise<readonly Document[]>;

  /** Documents restés `awaiting_upload` créés avant `createdBefore`. */
  findAbandonedUploads(createdBefore: Date, limit: number): Promise<readonly AbandonedUpload[]>;

  /**
   * Supprime le document **seulement s'il est encore** `awaiting_upload`.
   * `false` si une confirmation l'a fait passer `uploaded` entre-temps :
   * l'appelant ne doit alors PAS supprimer le fichier.
   */
  deleteIfAwaitingUpload(id: DocumentId): Promise<boolean>;

  // --- Extraction (worker : pas de filtre propriétaire) ------------------

  findById(id: DocumentId): Promise<Document | null>;

  /** `uploaded`/`extracting` → `extracting`. `false` si le statut ne le permet plus. */
  markExtracting(id: DocumentId, at: Date): Promise<boolean>;

  /**
   * **Atomique** : enregistre toutes les pages ET passe le document en
   * `text_ready` (compteurs renseignés), seulement s'il est `extracting`.
   * `false` si une autre exécution l'a déjà fait (aucune page écrite).
   */
  completeExtraction(
    id: DocumentId,
    pages: readonly PreparedPage[],
    charCount: number,
    at: Date,
  ): Promise<boolean>;

  /** `uploaded`/`extracting` → `extraction_failed` avec la raison. */
  markExtractionFailed(id: DocumentId, reason: ExtractionFailureReason, at: Date): Promise<void>;

  /** Trace la suppression du PDF source (CdC §8). */
  markSourceDeleted(id: DocumentId, at: Date): Promise<void>;

  /** Documents `uploaded` sans changement depuis `updatedBefore` (extraction jamais lancée). */
  findStalledUploads(updatedBefore: Date, limit: number): Promise<readonly DocumentId[]>;

  // --- Pages (RF-06) ------------------------------------------------------

  /** Pages dans l'ordre, strictement après `afterPageNumber`, au plus `limit`. */
  listPages(
    documentId: DocumentId,
    afterPageNumber: number,
    limit: number,
  ): Promise<readonly DocumentPage[]>;

  /**
   * **Atomique** : remplace le texte d'une page et recalcule `charCount` du
   * document. `null` si la page n'existe pas.
   */
  updatePageText(
    documentId: DocumentId,
    pageNumber: number,
    text: string,
    charCount: number,
    at: Date,
  ): Promise<DocumentPage | null>;
}
