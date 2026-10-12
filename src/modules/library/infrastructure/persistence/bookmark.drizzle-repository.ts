import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';

import { DRIZZLE_CLIENT, type DrizzleClient } from '@/shared/persistence';

import { type Bookmark } from '../../domain/entities/bookmark.entity';
import {
  type BookmarkChange,
  type BookmarkRepositoryPort,
} from '../../domain/ports/bookmark-repository.port';

import { bookmarks } from './schema/library.schema';

/** Colonnes explicites (jamais `SELECT *`, performance-rules.md). */
const BOOKMARK_COLUMNS = {
  id: bookmarks.id,
  ownerId: bookmarks.ownerId,
  documentId: bookmarks.documentId,
  pageNumber: bookmarks.pageNumber,
  wordIndex: bookmarks.wordIndex,
  excerpt: bookmarks.excerpt,
  note: bookmarks.note,
  createdAt: bookmarks.createdAt,
  updatedAt: bookmarks.updatedAt,
  deletedAt: bookmarks.deletedAt,
};

/** Marque-pages (ADR-0028) : « le plus récent gagne » par ligne, en une instruction. */
@Injectable()
export class DrizzleBookmarkRepository implements BookmarkRepositoryPort {
  constructor(@Inject(DRIZZLE_CLIENT) private readonly db: DrizzleClient) {}

  async findById(id: string): Promise<Bookmark | null> {
    const rows = await this.db
      .select(BOOKMARK_COLUMNS)
      .from(bookmarks)
      .where(eq(bookmarks.id, id))
      .limit(1);
    return rows.at(0) ?? null;
  }

  async countActive(documentId: string, ownerId: string): Promise<number> {
    const rows = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(bookmarks)
      .where(this.activeOf(documentId, ownerId));
    return rows.at(0)?.count ?? 0;
  }

  listActive(documentId: string, ownerId: string): Promise<readonly Bookmark[]> {
    return this.db
      .select(BOOKMARK_COLUMNS)
      .from(bookmarks)
      .where(this.activeOf(documentId, ownerId))
      .orderBy(asc(bookmarks.pageNumber), asc(bookmarks.wordIndex), asc(bookmarks.createdAt));
  }

  async insert(bookmark: Bookmark): Promise<boolean> {
    const inserted = await this.db
      .insert(bookmarks)
      .values(bookmark)
      .onConflictDoNothing({ target: bookmarks.id })
      .returning({ id: bookmarks.id });
    return inserted.length > 0;
  }

  async applyChange(
    id: string,
    ownerId: string,
    documentId: string,
    change: BookmarkChange,
  ): Promise<Bookmark | null> {
    const set =
      change.kind === 'edit'
        ? { note: change.note, updatedAt: change.at, deletedAt: null }
        : { updatedAt: change.at, deletedAt: change.at };
    // Condition dans l'UPDATE : deux appareils qui écrivent en même temps ne
    // peuvent pas faire gagner le plus ancien.
    const updated = await this.db
      .update(bookmarks)
      .set(set)
      .where(
        and(
          eq(bookmarks.id, id),
          eq(bookmarks.ownerId, ownerId),
          eq(bookmarks.documentId, documentId),
          sql`${bookmarks.updatedAt} < ${change.at.toISOString()}::timestamptz`,
        ),
      )
      .returning(BOOKMARK_COLUMNS);
    const row = updated.at(0);
    if (row !== undefined) return row;
    // Modification plus ancienne (ignorée) ou identifiant inconnu : l'état retenu.
    const current = await this.findById(id);
    return current?.ownerId === ownerId && current.documentId === documentId ? current : null;
  }

  private activeOf(documentId: string, ownerId: string) {
    return and(
      eq(bookmarks.documentId, documentId),
      eq(bookmarks.ownerId, ownerId),
      isNull(bookmarks.deletedAt),
    );
  }
}
