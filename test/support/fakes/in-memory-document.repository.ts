import { type Document } from '@/modules/document/domain/entities/document.entity';
import {
  type AbandonedUpload,
  type DocumentPagePosition,
  type DocumentRepositoryPort,
} from '@/modules/document/domain/ports/document-repository.port';
import { type DocumentId } from '@/modules/document/domain/value-objects/document-id.vo';
import { DocumentStatus } from '@/modules/document/domain/value-objects/document-status.vo';
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

  listUploadedByOwner(
    ownerId: OwnerId,
    after: DocumentPagePosition | null,
    limit: number,
  ): Promise<readonly Document[]> {
    const items = [...this.rows.values()]
      .filter((d) => d.ownerId === ownerId && d.status === DocumentStatus.UPLOADED)
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
}
