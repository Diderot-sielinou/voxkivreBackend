import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt, gte, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm';

import { DRIZZLE_CLIENT, type DrizzleClient } from '@/shared/persistence';

import { type DocumentPage } from '../../domain/entities/document-page.entity';
import { type Document } from '../../domain/entities/document.entity';
import {
  type AbandonedUpload,
  type CompletedExtraction,
  type DeletedDocument,
  type DocumentPagePosition,
  type DocumentRepositoryPort,
} from '../../domain/ports/document-repository.port';
import { type PreparedPage } from '../../domain/services/extracted-text';
import { type OcrPage } from '../../domain/services/ocr';
import { type SetAsideLine } from '../../domain/services/text-cleaning';
import { DocumentId } from '../../domain/value-objects/document-id.vo';
import { type DocumentSize } from '../../domain/value-objects/document-size.vo';
import {
  DocumentStatus,
  ExtractionFailureReason,
  ExtractionMethod,
} from '../../domain/value-objects/document-status.vo';
import { type DocumentTitle } from '../../domain/value-objects/document-title.vo';
import { OwnerId } from '../../domain/value-objects/owner-id.vo';

import { documentOcrPages, documentPages, documents } from './schema/document.schema';

/** Colonnes explicites (jamais `SELECT *`, performance-rules.md). */
const DOCUMENT_COLUMNS = {
  id: documents.id,
  ownerId: documents.ownerId,
  title: documents.title,
  status: documents.status,
  sizeBytes: documents.sizeBytes,
  sourceKey: documents.sourceKey,
  rightsAttestedAt: documents.rightsAttestedAt,
  rightsAttestationVersion: documents.rightsAttestationVersion,
  uploadedAt: documents.uploadedAt,
  pageCount: documents.pageCount,
  charCount: documents.charCount,
  textRevision: documents.textRevision,
  extractionError: documents.extractionError,
  extractionMethod: documents.extractionMethod,
  ocrPageCount: documents.ocrPageCount,
  reviewRequired: documents.reviewRequired,
  reviewedAt: documents.reviewedAt,
  outline: documents.outline,
  sourceDeletedAt: documents.sourceDeletedAt,
  createdAt: documents.createdAt,
  updatedAt: documents.updatedAt,
};

const PAGE_COLUMNS = {
  documentId: documentPages.documentId,
  pageNumber: documentPages.pageNumber,
  text: documentPages.text,
  charCount: documentPages.charCount,
  setAside: documentPages.setAside,
  ocrConfidence: documentPages.ocrConfidence,
  updatedAt: documentPages.updatedAt,
};

const OCR_PAGE_COLUMNS = {
  pageNumber: documentOcrPages.pageNumber,
  lines: documentOcrPages.lines,
  confidence: documentOcrPages.confidence,
};

type DocumentRow = {
  [K in keyof typeof DOCUMENT_COLUMNS]: (typeof documents.$inferSelect)[K];
};
type PageRow = { [K in keyof typeof PAGE_COLUMNS]: (typeof documentPages.$inferSelect)[K] };

/** Statuts depuis lesquels une extraction peut (re)démarrer ou échouer. */
const EXTRACTABLE_STATUSES = [DocumentStatus.UPLOADED, DocumentStatus.EXTRACTING];

/**
 * Pages écrites par paquets : borne la taille d'une requête (un livre de
 * 2 000 pages × 5 colonnes = 10 000 paramètres en un seul INSERT).
 */
const PAGE_INSERT_CHUNK = 500;

const STATUSES = new Set<string>(Object.values(DocumentStatus));
const FAILURE_REASONS = new Set<string>(Object.values(ExtractionFailureReason));
const METHODS = new Set<string>(Object.values(ExtractionMethod));

/**
 * Reconstitue l'entité depuis une ligne. Les valeurs ont été validées par le
 * domaine à l'écriture et les `CHECK` gardent `status` : une valeur inconnue
 * est un bug de migration, signalé par une exception plutôt que masqué.
 */
function toDocument(row: DocumentRow): Document {
  if (!STATUSES.has(row.status)) throw new Error(`Unknown document status "${row.status}"`);
  const extractionError =
    row.extractionError !== null && FAILURE_REASONS.has(row.extractionError)
      ? (row.extractionError as ExtractionFailureReason)
      : null;
  return {
    id: DocumentId.of(row.id),
    ownerId: OwnerId.of(row.ownerId),
    title: row.title as DocumentTitle,
    status: row.status as DocumentStatus,
    sizeBytes: row.sizeBytes as DocumentSize,
    sourceKey: row.sourceKey,
    rightsAttestedAt: row.rightsAttestedAt,
    rightsAttestationVersion: row.rightsAttestationVersion,
    uploadedAt: row.uploadedAt,
    pageCount: row.pageCount,
    charCount: row.charCount,
    textRevision: row.textRevision,
    extractionError,
    // Gardé par le `CHECK` `documents_extraction_method_check`.
    extractionMethod:
      row.extractionMethod !== null && METHODS.has(row.extractionMethod)
        ? (row.extractionMethod as ExtractionMethod)
        : null,
    ocrPageCount: row.ocrPageCount,
    reviewRequired: row.reviewRequired,
    reviewedAt: row.reviewedAt,
    // Écrit uniquement par l'extraction, à partir de `Outline` (invariant).
    outline: row.outline,
    sourceDeletedAt: row.sourceDeletedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toPage(row: PageRow): DocumentPage {
  return {
    documentId: DocumentId.of(row.documentId),
    pageNumber: row.pageNumber,
    text: row.text,
    charCount: row.charCount,
    // Écrit uniquement par l'extraction, à partir de `SetAsideReason` (invariant).
    setAside: row.setAside as readonly SetAsideLine[] | null,
    ocrConfidence: row.ocrConfidence,
    updatedAt: row.updatedAt,
  };
}

@Injectable()
export class DrizzleDocumentRepository implements DocumentRepositoryPort {
  constructor(@Inject(DRIZZLE_CLIENT) private readonly db: DrizzleClient) {}

  async insert(document: Document, uploadId: string | null = null): Promise<void> {
    await this.db.insert(documents).values({
      uploadId,
      id: document.id,
      ownerId: document.ownerId,
      title: document.title,
      status: document.status,
      sizeBytes: document.sizeBytes,
      sourceKey: document.sourceKey,
      rightsAttestedAt: document.rightsAttestedAt,
      rightsAttestationVersion: document.rightsAttestationVersion,
      uploadedAt: document.uploadedAt,
      pageCount: document.pageCount,
      charCount: document.charCount,
      textRevision: document.textRevision,
      extractionError: document.extractionError,
      extractionMethod: document.extractionMethod,
      ocrPageCount: document.ocrPageCount,
      reviewRequired: document.reviewRequired,
      reviewedAt: document.reviewedAt,
      outline: document.outline,
      sourceDeletedAt: document.sourceDeletedAt,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
    });
  }

  async findByIdForOwner(id: DocumentId, ownerId: OwnerId): Promise<Document | null> {
    const rows = await this.db
      .select(DOCUMENT_COLUMNS)
      .from(documents)
      .where(and(eq(documents.id, id), eq(documents.ownerId, ownerId)))
      .limit(1);
    const row = rows.at(0);
    return row === undefined ? null : toDocument(row);
  }

  async deleteForOwner(
    id: DocumentId,
    ownerId: OwnerId,
    tx?: unknown,
  ): Promise<DeletedDocument | null> {
    const db = (tx as DrizzleClient | undefined) ?? this.db;
    const deleted = await db
      .delete(documents)
      .where(and(eq(documents.id, id), eq(documents.ownerId, ownerId)))
      .returning({ sourceKey: documents.sourceKey, sourceDeletedAt: documents.sourceDeletedAt });
    const row = deleted.at(0);
    return row === undefined
      ? null
      : { sourceKey: row.sourceKey, sourceDeleted: row.sourceDeletedAt !== null };
  }

  async listLiveSourceKeysForOwner(ownerId: OwnerId, tx?: unknown): Promise<readonly string[]> {
    const db = (tx as DrizzleClient | undefined) ?? this.db;
    const rows = await db
      .select({ sourceKey: documents.sourceKey })
      .from(documents)
      .where(and(eq(documents.ownerId, ownerId), isNull(documents.sourceDeletedAt)));
    return rows.map((row) => row.sourceKey);
  }

  async findById(id: DocumentId): Promise<Document | null> {
    const rows = await this.db
      .select(DOCUMENT_COLUMNS)
      .from(documents)
      .where(eq(documents.id, id))
      .limit(1);
    const row = rows.at(0);
    return row === undefined ? null : toDocument(row);
  }

  async markUploaded(id: DocumentId, uploadedAt: Date): Promise<void> {
    await this.db
      .update(documents)
      .set({ status: DocumentStatus.UPLOADED, uploadedAt, updatedAt: uploadedAt })
      .where(and(eq(documents.id, id), eq(documents.status, DocumentStatus.AWAITING_UPLOAD)));
  }

  async listImportedByOwner(
    ownerId: OwnerId,
    after: DocumentPagePosition | null,
    limit: number,
  ): Promise<readonly Document[]> {
    // Même prédicat que l'index partiel `documents_owner_library_idx`.
    const ownerFilter = and(
      eq(documents.ownerId, ownerId),
      ne(documents.status, DocumentStatus.AWAITING_UPLOAD),
    );
    // Keyset `(created_at, id) < (after.createdAt, after.id)` en ordre DESC.
    const where =
      after === null
        ? ownerFilter
        : and(
            ownerFilter,
            or(
              lt(documents.createdAt, after.createdAt),
              and(eq(documents.createdAt, after.createdAt), lt(documents.id, after.id)),
            ),
          );
    const rows = await this.db
      .select(DOCUMENT_COLUMNS)
      .from(documents)
      .where(where)
      .orderBy(desc(documents.createdAt), desc(documents.id))
      .limit(limit);
    return rows.map((row) => toDocument(row));
  }

  async findAbandonedUploads(
    createdBefore: Date,
    limit: number,
  ): Promise<readonly AbandonedUpload[]> {
    const rows = await this.db
      .select({ id: documents.id, sourceKey: documents.sourceKey, uploadId: documents.uploadId })
      .from(documents)
      .where(
        and(
          eq(documents.status, DocumentStatus.AWAITING_UPLOAD),
          lt(documents.createdAt, createdBefore),
        ),
      )
      .orderBy(documents.createdAt)
      .limit(limit);
    return rows.map((row) => ({
      id: DocumentId.of(row.id),
      sourceKey: row.sourceKey,
      uploadId: row.uploadId,
    }));
  }

  async findUploadId(id: DocumentId): Promise<string | null> {
    const rows = await this.db
      .select({ uploadId: documents.uploadId })
      .from(documents)
      .where(eq(documents.id, id))
      .limit(1);
    return rows.length === 0 ? null : rows[0].uploadId;
  }

  async deleteIfAwaitingUpload(id: DocumentId): Promise<boolean> {
    const deleted = await this.db
      .delete(documents)
      .where(and(eq(documents.id, id), eq(documents.status, DocumentStatus.AWAITING_UPLOAD)))
      .returning({ id: documents.id });
    return deleted.length > 0;
  }

  async markExtracting(id: DocumentId, at: Date): Promise<boolean> {
    const updated = await this.db
      .update(documents)
      .set({ status: DocumentStatus.EXTRACTING, updatedAt: at })
      .where(and(eq(documents.id, id), inArray(documents.status, EXTRACTABLE_STATUSES)))
      .returning({ id: documents.id });
    return updated.length > 0;
  }

  async completeExtraction(
    id: DocumentId,
    pages: readonly PreparedPage[],
    charCount: number,
    extraction: CompletedExtraction,
    at: Date,
  ): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      // Le passage de statut d'abord : il verrouille la ligne, et une
      // exécution concurrente qui arrive en second ne trouve plus `extracting`.
      const updated = await tx
        .update(documents)
        .set({
          status: DocumentStatus.TEXT_READY,
          pageCount: pages.length,
          charCount,
          textRevision: 1,
          extractionError: null,
          extractionMethod: extraction.method,
          reviewRequired: extraction.reviewRequired,
          outline: extraction.outline,
          updatedAt: at,
        })
        .where(and(eq(documents.id, id), eq(documents.status, DocumentStatus.EXTRACTING)))
        .returning({ id: documents.id });
      if (updated.length === 0) return false;

      for (let i = 0; i < pages.length; i += PAGE_INSERT_CHUNK) {
        await tx.insert(documentPages).values(
          pages.slice(i, i + PAGE_INSERT_CHUNK).map((page) => ({
            documentId: id,
            pageNumber: page.pageNumber,
            text: page.text,
            charCount: page.charCount,
            setAside: page.setAside,
            ocrConfidence: page.ocrConfidence,
            updatedAt: at,
          })),
        );
      }
      // Les lignes brutes n'ont plus d'usage : le texte nettoyé fait foi.
      await tx.delete(documentOcrPages).where(eq(documentOcrPages.documentId, id));
      return true;
    });
  }

  async markExtractionFailed(
    id: DocumentId,
    reason: ExtractionFailureReason,
    at: Date,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .update(documents)
        .set({ status: DocumentStatus.EXTRACTION_FAILED, extractionError: reason, updatedAt: at })
        .where(and(eq(documents.id, id), inArray(documents.status, EXTRACTABLE_STATUSES)));
      await tx.delete(documentOcrPages).where(eq(documentOcrPages.documentId, id));
    });
  }

  async markSourceDeleted(id: DocumentId, at: Date): Promise<void> {
    await this.db
      .update(documents)
      .set({ sourceDeletedAt: at, updatedAt: at })
      .where(and(eq(documents.id, id), sql`${documents.sourceDeletedAt} is null`));
  }

  async findStalledUploads(updatedBefore: Date, limit: number): Promise<readonly DocumentId[]> {
    const rows = await this.db
      .select({ id: documents.id })
      .from(documents)
      .where(
        and(eq(documents.status, DocumentStatus.UPLOADED), lt(documents.updatedAt, updatedBefore)),
      )
      .orderBy(documents.updatedAt)
      .limit(limit);
    return rows.map((row) => DocumentId.of(row.id));
  }

  async startOcr(id: DocumentId, pageCount: number, at: Date): Promise<boolean> {
    const updated = await this.db
      .update(documents)
      .set({ extractionMethod: ExtractionMethod.OCR, ocrPageCount: pageCount, updatedAt: at })
      .where(
        and(
          eq(documents.id, id),
          eq(documents.status, DocumentStatus.EXTRACTING),
          isNull(documents.extractionMethod),
        ),
      )
      .returning({ id: documents.id });
    return updated.length > 0;
  }

  async countOcrPagesSince(ownerId: OwnerId, since: Date): Promise<number> {
    // Même prédicat que l'index partiel `documents_owner_ocr_idx`.
    const rows = await this.db
      .select({ pages: sql<number>`coalesce(sum(${documents.ocrPageCount}), 0)::int` })
      .from(documents)
      .where(
        and(
          eq(documents.ownerId, ownerId),
          eq(documents.extractionMethod, ExtractionMethod.OCR),
          gte(documents.uploadedAt, since),
        ),
      );
    return rows.at(0)?.pages ?? 0;
  }

  async saveOcrPages(id: DocumentId, pages: readonly OcrPage[], at: Date): Promise<void> {
    if (pages.length === 0) return;
    await this.db.transaction(async (tx) => {
      await tx
        .insert(documentOcrPages)
        .values(
          pages.map((page) => ({
            documentId: id,
            pageNumber: page.pageNumber,
            lines: page.lines,
            confidence: page.confidence,
            recognizedAt: at,
          })),
        )
        .onConflictDoUpdate({
          target: [documentOcrPages.documentId, documentOcrPages.pageNumber],
          set: {
            lines: sql`excluded.lines`,
            confidence: sql`excluded.confidence`,
            recognizedAt: sql`excluded.recognized_at`,
          },
        });
      // Le progrès date le document : le balayage ne relance qu'un OCR immobile.
      await tx.update(documents).set({ updatedAt: at }).where(eq(documents.id, id));
    });
  }

  async listOcrPageNumbers(id: DocumentId): Promise<readonly number[]> {
    const rows = await this.db
      .select({ pageNumber: documentOcrPages.pageNumber })
      .from(documentOcrPages)
      .where(eq(documentOcrPages.documentId, id))
      .orderBy(asc(documentOcrPages.pageNumber));
    return rows.map((row) => row.pageNumber);
  }

  async listOcrPages(id: DocumentId): Promise<readonly OcrPage[]> {
    const rows = await this.db
      .select(OCR_PAGE_COLUMNS)
      .from(documentOcrPages)
      .where(eq(documentOcrPages.documentId, id))
      .orderBy(asc(documentOcrPages.pageNumber));
    return rows.map((row) => ({
      pageNumber: row.pageNumber,
      lines: row.lines,
      confidence: row.confidence,
    }));
  }

  async findStalledOcr(updatedBefore: Date, limit: number): Promise<readonly DocumentId[]> {
    const rows = await this.db
      .select({ id: documents.id })
      .from(documents)
      .where(
        and(
          eq(documents.status, DocumentStatus.EXTRACTING),
          eq(documents.extractionMethod, ExtractionMethod.OCR),
          lt(documents.updatedAt, updatedBefore),
        ),
      )
      .orderBy(documents.updatedAt)
      .limit(limit);
    return rows.map((row) => DocumentId.of(row.id));
  }

  async markReviewed(id: DocumentId, ownerId: OwnerId, at: Date): Promise<Document | null> {
    const updated = await this.db
      .update(documents)
      .set({ reviewedAt: sql`coalesce(${documents.reviewedAt}, ${at.toISOString()}::timestamptz)` })
      .where(and(eq(documents.id, id), eq(documents.ownerId, ownerId)))
      .returning(DOCUMENT_COLUMNS);
    const row = updated.at(0);
    return row === undefined ? null : toDocument(row);
  }

  async rename(
    id: DocumentId,
    ownerId: OwnerId,
    title: DocumentTitle,
    at: Date,
  ): Promise<Document | null> {
    const updated = await this.db
      .update(documents)
      .set({ title, updatedAt: at })
      .where(and(eq(documents.id, id), eq(documents.ownerId, ownerId)))
      .returning(DOCUMENT_COLUMNS);
    const row = updated.at(0);
    return row === undefined ? null : toDocument(row);
  }

  async listPagesByNumbers(
    documentId: DocumentId,
    pageNumbers: readonly number[],
  ): Promise<readonly DocumentPage[]> {
    if (pageNumbers.length === 0) return [];
    const rows = await this.db
      .select(PAGE_COLUMNS)
      .from(documentPages)
      .where(
        and(
          eq(documentPages.documentId, documentId),
          inArray(documentPages.pageNumber, [...new Set(pageNumbers)]),
        ),
      )
      .orderBy(asc(documentPages.pageNumber));
    return rows.map((row) => toPage(row));
  }

  async listPages(
    documentId: DocumentId,
    afterPageNumber: number,
    limit: number,
  ): Promise<readonly DocumentPage[]> {
    const rows = await this.db
      .select(PAGE_COLUMNS)
      .from(documentPages)
      .where(
        and(
          eq(documentPages.documentId, documentId),
          gt(documentPages.pageNumber, afterPageNumber),
        ),
      )
      .orderBy(asc(documentPages.pageNumber))
      .limit(limit);
    return rows.map((row) => toPage(row));
  }

  async updatePageText(
    documentId: DocumentId,
    pageNumber: number,
    text: string,
    charCount: number,
    at: Date,
  ): Promise<DocumentPage | null> {
    return this.db.transaction(async (tx) => {
      const updated = await tx
        .update(documentPages)
        .set({ text, charCount, updatedAt: at })
        .where(
          and(eq(documentPages.documentId, documentId), eq(documentPages.pageNumber, pageNumber)),
        )
        .returning(PAGE_COLUMNS);
      const row = updated.at(0);
      if (row === undefined) return null;

      // Total recalculé depuis les pages (pas un delta) : juste même après
      // des corrections concurrentes sur deux pages.
      await tx
        .update(documents)
        .set({
          charCount: sql`(select coalesce(sum(${documentPages.charCount}), 0) from ${documentPages} where ${documentPages.documentId} = ${documentId})`,
          textRevision: sql`${documents.textRevision} + 1`,
          updatedAt: at,
        })
        .where(eq(documents.id, documentId));
      return toPage(row);
    });
  }
}
