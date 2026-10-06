import { type DocumentPage } from '@/modules/document/domain/entities/document-page.entity';
import { type Document } from '@/modules/document/domain/entities/document.entity';
import {
  type AbandonedUpload,
  type DocumentPagePosition,
  type DocumentRepositoryPort,
} from '@/modules/document/domain/ports/document-repository.port';
import { type PreparedPage } from '@/modules/document/domain/services/extracted-text';
import { type DocumentId } from '@/modules/document/domain/value-objects/document-id.vo';
import {
  DocumentStatus,
  type ExtractionFailureReason,
} from '@/modules/document/domain/value-objects/document-status.vo';
import { type OwnerId } from '@/modules/document/domain/value-objects/owner-id.vo';

/** Comparaison `(createdAt DESC, id DESC)` — même ordre que l'adapter Drizzle. */
function newestFirst(a: Document, b: Document): number {
  const byDate = b.createdAt.getTime() - a.createdAt.getTime();
  if (byDate !== 0) return byDate;
  if (a.id === b.id) return 0;
  return a.id < b.id ? 1 : -1;
}

function isAfter(d: Document, after: DocumentPagePosition): boolean {
  const t = d.createdAt.getTime();
  const at = after.createdAt.getTime();
  return t < at || (t === at && d.id < after.id);
}

/** Fake du `DocumentRepositoryPort` pour les tests unitaires et e2e. */
export class InMemoryDocumentRepository implements DocumentRepositoryPort {
  readonly rows = new Map<string, Document>();
  /** Pages par document, rangées par numéro. */
  readonly pages = new Map<string, DocumentPage[]>();

  insert(document: Document): Promise<void> {
    this.rows.set(document.id, document);
    return Promise.resolve();
  }

  findByIdForOwner(id: DocumentId, ownerId: OwnerId): Promise<Document | null> {
    const found = this.rows.get(id);
    return Promise.resolve(found?.ownerId === ownerId ? found : null);
  }

  markUploaded(id: DocumentId, uploadedAt: Date): Promise<void> {
    const found = this.rows.get(id);
    if (found?.status === DocumentStatus.AWAITING_UPLOAD) {
      this.rows.set(id, {
        ...found,
        status: DocumentStatus.UPLOADED,
        uploadedAt,
        updatedAt: uploadedAt,
      });
    }
    return Promise.resolve();
  }

  listImportedByOwner(
    ownerId: OwnerId,
    after: DocumentPagePosition | null,
    limit: number,
  ): Promise<readonly Document[]> {
    const items = [...this.rows.values()]
      .filter((d) => d.ownerId === ownerId && d.status !== DocumentStatus.AWAITING_UPLOAD)
      .filter((d) => after === null || isAfter(d, after))
      .toSorted(newestFirst)
      .slice(0, limit);
    return Promise.resolve(items);
  }

  findAbandonedUploads(createdBefore: Date, limit: number): Promise<readonly AbandonedUpload[]> {
    const items = [...this.rows.values()]
      .filter(
        (d) =>
          d.status === DocumentStatus.AWAITING_UPLOAD &&
          d.createdAt.getTime() < createdBefore.getTime(),
      )
      .slice(0, limit)
      .map((d) => ({ id: d.id, sourceKey: d.sourceKey }));
    return Promise.resolve(items);
  }

  deleteIfAwaitingUpload(id: DocumentId): Promise<boolean> {
    const found = this.rows.get(id);
    if (found?.status !== DocumentStatus.AWAITING_UPLOAD) return Promise.resolve(false);
    this.rows.delete(id);
    return Promise.resolve(true);
  }

  findById(id: DocumentId): Promise<Document | null> {
    return Promise.resolve(this.rows.get(id) ?? null);
  }

  markExtracting(id: DocumentId, at: Date): Promise<boolean> {
    return Promise.resolve(
      this.patchIf(id, [DocumentStatus.UPLOADED, DocumentStatus.EXTRACTING], {
        status: DocumentStatus.EXTRACTING,
        updatedAt: at,
      }),
    );
  }

  completeExtraction(
    id: DocumentId,
    pages: readonly PreparedPage[],
    charCount: number,
    at: Date,
  ): Promise<boolean> {
    const done = this.patchIf(id, [DocumentStatus.EXTRACTING], {
      status: DocumentStatus.TEXT_READY,
      pageCount: pages.length,
      charCount,
      textRevision: 1,
      extractionError: null,
      updatedAt: at,
    });
    if (done) {
      this.pages.set(
        id,
        pages.map((p) => ({ documentId: id, ...p, updatedAt: at })),
      );
    }
    return Promise.resolve(done);
  }

  markExtractionFailed(id: DocumentId, reason: ExtractionFailureReason, at: Date): Promise<void> {
    this.patchIf(id, [DocumentStatus.UPLOADED, DocumentStatus.EXTRACTING], {
      status: DocumentStatus.EXTRACTION_FAILED,
      extractionError: reason,
      updatedAt: at,
    });
    return Promise.resolve();
  }

  markSourceDeleted(id: DocumentId, at: Date): Promise<void> {
    const found = this.rows.get(id);
    if (found?.sourceDeletedAt === null) {
      this.rows.set(id, { ...found, sourceDeletedAt: at, updatedAt: at });
    }
    return Promise.resolve();
  }

  findStalledUploads(updatedBefore: Date, limit: number): Promise<readonly DocumentId[]> {
    const ids = [...this.rows.values()]
      .filter(
        (d) =>
          d.status === DocumentStatus.UPLOADED && d.updatedAt.getTime() < updatedBefore.getTime(),
      )
      .slice(0, limit)
      .map((d) => d.id);
    return Promise.resolve(ids);
  }

  listPages(
    documentId: DocumentId,
    afterPageNumber: number,
    limit: number,
  ): Promise<readonly DocumentPage[]> {
    const pages = (this.pages.get(documentId) ?? [])
      .filter((p) => p.pageNumber > afterPageNumber)
      .slice(0, limit);
    return Promise.resolve(pages);
  }

  updatePageText(
    documentId: DocumentId,
    pageNumber: number,
    text: string,
    charCount: number,
    at: Date,
  ): Promise<DocumentPage | null> {
    const pages = this.pages.get(documentId) ?? [];
    const index = pages.findIndex((p) => p.pageNumber === pageNumber);
    if (index === -1) return Promise.resolve(null);
    const current = pages[index];
    const updated = { ...current, text, charCount, updatedAt: at };
    pages[index] = updated;
    const doc = this.rows.get(documentId);
    if (doc !== undefined) {
      const total = pages.reduce((sum, p) => sum + p.charCount, 0);
      this.rows.set(documentId, {
        ...doc,
        charCount: total,
        textRevision: doc.textRevision + 1,
        updatedAt: at,
      });
    }
    return Promise.resolve(updated);
  }

  private patchIf(
    id: DocumentId,
    allowed: readonly DocumentStatus[],
    patch: Partial<Document>,
  ): boolean {
    const found = this.rows.get(id);
    if (found === undefined || !allowed.includes(found.status)) return false;
    this.rows.set(id, { ...found, ...patch });
    return true;
  }
}
