import { type DocumentPage } from '../entities/document-page.entity';
import { type Document } from '../entities/document.entity';
import { type PreparedPage } from '../services/extracted-text';
import { type OcrPage } from '../services/ocr';
import { type Outline } from '../services/outline';
import { type DocumentId } from '../value-objects/document-id.vo';
import {
  type ExtractionFailureReason,
  type ExtractionMethod,
} from '../value-objects/document-status.vo';
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

export interface DeletedDocument {
  readonly sourceKey: string;
  /** Le PDF a déjà été effacé après l'extraction (CdC §8). */
  readonly sourceDeleted: boolean;
}

/** Comment le texte a été obtenu, enregistré avec les pages. */
export interface CompletedExtraction {
  readonly method: ExtractionMethod;
  /** Une page OCR sous le seuil de confiance (RF-06). */
  readonly reviewRequired: boolean;
  /** Table des matières (ADR-0027). */
  readonly outline: Outline;
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

  /**
   * Supprime le document du propriétaire (pages, conversions et positions
   * en cascade), dans la transaction ambiante (ADR-0016). Renvoie la clé du
   * PDF source et s'il a déjà été effacé, ou `null` si absent / à quelqu'un
   * d'autre (RNF-08).
   */
  deleteForOwner(id: DocumentId, ownerId: OwnerId, tx?: unknown): Promise<DeletedDocument | null>;

  /**
   * Clés des PDF sources du propriétaire pas encore effacés (envoi en
   * attente compris), dans la transaction ambiante : suppression du compte
   * (ADR-0023).
   */
  listLiveSourceKeysForOwner(ownerId: OwnerId, tx?: unknown): Promise<readonly string[]>;

  // --- Extraction (worker : pas de filtre propriétaire) ------------------

  findById(id: DocumentId): Promise<Document | null>;

  /** `uploaded`/`extracting` → `extracting`. `false` si le statut ne le permet plus. */
  markExtracting(id: DocumentId, at: Date): Promise<boolean>;

  /**
   * **Atomique** : enregistre toutes les pages ET passe le document en
   * `text_ready` (compteurs, méthode et relecture renseignés), seulement
   * s'il est `extracting` ; efface les lignes brutes de l'OCR. `false` si
   * une autre exécution l'a déjà fait (aucune page écrite).
   */
  completeExtraction(
    id: DocumentId,
    pages: readonly PreparedPage[],
    charCount: number,
    extraction: CompletedExtraction,
    at: Date,
  ): Promise<boolean>;

  /**
   * `uploaded`/`extracting` → `extraction_failed` avec la raison ; efface
   * les lignes brutes d'un OCR commencé. */
  markExtractionFailed(id: DocumentId, reason: ExtractionFailureReason, at: Date): Promise<void>;

  /** Trace la suppression du PDF source (CdC §8). */
  markSourceDeleted(id: DocumentId, at: Date): Promise<void>;

  /** Documents `uploaded` sans changement depuis `updatedBefore` (extraction jamais lancée). */
  findStalledUploads(updatedBefore: Date, limit: number): Promise<readonly DocumentId[]>;

  // --- OCR (ADR-0024) ------------------------------------------------------

  /**
   * Passe un document `extracting` à l'OCR (méthode et nombre de pages).
   * `false` s'il n'est plus `extracting` ou déjà passé à l'OCR.
   */
  startOcr(id: DocumentId, pageCount: number, at: Date): Promise<boolean>;

  /**
   * Pages passées à l'OCR par les documents du propriétaire importés depuis
   * `since` (plafond mensuel d'un compte gratuit).
   */
  countOcrPagesSince(ownerId: OwnerId, since: Date): Promise<number>;

  /**
   * Enregistre les pages reconnues d'un lot (réécriture idempotente par
   * numéro de page) et date le progrès du document (balayage).
   */
  saveOcrPages(id: DocumentId, pages: readonly OcrPage[], at: Date): Promise<void>;

  /** Numéros des pages déjà reconnues, dans l'ordre. */
  listOcrPageNumbers(id: DocumentId): Promise<readonly number[]>;

  /** Toutes les pages reconnues, dans l'ordre. */
  listOcrPages(id: DocumentId): Promise<readonly OcrPage[]>;

  /** OCR en cours sans progrès depuis `updatedBefore`. */
  findStalledOcr(updatedBefore: Date, limit: number): Promise<readonly DocumentId[]>;

  /**
   * Note la relecture du propriétaire (RF-06), une seule fois : la date de
   * la première relecture est gardée. `null` si absent / à quelqu'un
   * d'autre.
   */
  markReviewed(id: DocumentId, ownerId: OwnerId, at: Date): Promise<Document | null>;

  // --- Pages (RF-06) ------------------------------------------------------

  /** Les pages demandées (en une requête), dans l'ordre ; les numéros absents sont ignorés. */
  listPagesByNumbers(
    documentId: DocumentId,
    pageNumbers: readonly number[],
  ): Promise<readonly DocumentPage[]>;

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
