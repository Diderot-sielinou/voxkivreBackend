import { type Bookmark } from '@/modules/library/domain/entities/bookmark.entity';
import {
  type BookmarkChange,
  type BookmarkRepositoryPort,
} from '@/modules/library/domain/ports/bookmark-repository.port';

/** Fake du `BookmarkRepositoryPort` : mêmes règles que l'adapter Drizzle (ADR-0028). */
export class InMemoryBookmarkRepository implements BookmarkRepositoryPort {
  readonly rows = new Map<string, Bookmark>();

  findById(id: string): Promise<Bookmark | null> {
    return Promise.resolve(this.rows.get(id) ?? null);
  }

  countActive(documentId: string, ownerId: string): Promise<number> {
    return Promise.resolve(this.active(documentId, ownerId).length);
  }

  listActive(documentId: string, ownerId: string): Promise<readonly Bookmark[]> {
    return Promise.resolve(
      this.active(documentId, ownerId).toSorted(
        (a, b) => a.pageNumber - b.pageNumber || a.wordIndex - b.wordIndex,
      ),
    );
  }

  insert(bookmark: Bookmark): Promise<boolean> {
    if (this.rows.has(bookmark.id)) return Promise.resolve(false);
    this.rows.set(bookmark.id, bookmark);
    return Promise.resolve(true);
  }

  applyChange(
    id: string,
    ownerId: string,
    documentId: string,
    change: BookmarkChange,
  ): Promise<Bookmark | null> {
    const found = this.rows.get(id);
    if (found?.ownerId !== ownerId || found.documentId !== documentId) {
      return Promise.resolve(null);
    }
    if (found.updatedAt.getTime() >= change.at.getTime()) return Promise.resolve(found);
    const next: Bookmark =
      change.kind === 'edit'
        ? { ...found, note: change.note, updatedAt: change.at, deletedAt: null }
        : { ...found, updatedAt: change.at, deletedAt: change.at };
    this.rows.set(id, next);
    return Promise.resolve(next);
  }

  private active(documentId: string, ownerId: string): Bookmark[] {
    return [...this.rows.values()].filter(
      (b) => b.documentId === documentId && b.ownerId === ownerId && b.deletedAt === null,
    );
  }
}
