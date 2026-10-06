import { type Document } from '../entities/document.entity';
import { type DocumentId } from '../value-objects/document-id.vo';
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
   * Documents importés (`uploaded`) du propriétaire, du plus récent au plus
   * ancien, strictement après `after`. Renvoie au plus `limit` lignes.
   */
  listUploadedByOwner(
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
}
