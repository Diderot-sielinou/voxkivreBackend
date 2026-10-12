import { Inject, Injectable } from '@nestjs/common';

import { CLOCK, type ClockPort, type DomainError, Result } from '@/shared/kernel';

import { type Bookmark } from '../../domain/entities/bookmark.entity';
import { DocumentNotFoundError } from '../../domain/errors/document-not-found.error';
import {
  BookmarkIdConflictError,
  BookmarksLimitConflictError,
  BookmarkTextNotReadyError,
  InvalidBookmarkAnchorError,
  InvalidBookmarkNoteError,
  InvalidBookmarkTimestampError,
} from '../../domain/errors/invalid-bookmark.error';
import {
  BOOKMARK_REPOSITORY,
  type BookmarkRepositoryPort,
} from '../../domain/ports/bookmark-repository.port';
import {
  LIBRARY_DOCUMENTS,
  type LibraryDocument,
  type LibraryDocumentsPort,
} from '../../domain/ports/library-documents.port';
import {
  type BookmarkView,
  excerptAt,
  pageWords,
  viewOf,
} from '../../domain/services/bookmark-anchor';
import {
  MAX_BOOKMARK_NOTE_LENGTH,
  MAX_BOOKMARKS_PER_DOCUMENT,
} from '../../domain/services/bookmark-policy';
import { CLOCK_SKEW_TOLERANCE_MS } from '../../domain/services/reading-position-policy';
import { DocumentState } from '../../domain/value-objects/library-item-status.vo';

export interface PutBookmarkInput {
  readonly ownerId: string;
  readonly documentId: string;
  readonly bookmarkId: string;
  readonly pageNumber: number;
  readonly wordIndex: number;
  readonly note: string;
  /** Instant (appareil) de la modification : le plus récent gagne. */
  readonly updatedAt: Date;
}

/**
 * `PUT /v1/documents/:id/bookmarks/:bookmarkId` (RF-27, ADR-0028) : crée le
 * marque-page (identifiant de l'appareil) ou met à jour sa note, « le plus
 * récent gagne » par marque-page. L'ancrage est fixé à la création. Rend
 * l'état retenu, suppression comprise, pour que l'appareil s'aligne.
 */
@Injectable()
export class PutBookmarkUseCase {
  constructor(
    @Inject(BOOKMARK_REPOSITORY) private readonly bookmarks: BookmarkRepositoryPort,
    @Inject(LIBRARY_DOCUMENTS) private readonly documents: LibraryDocumentsPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
  ) {}

  async execute(
    input: PutBookmarkInput,
  ): Promise<Result<{ readonly bookmark: BookmarkView; readonly created: boolean }, DomainError>> {
    const document = await this.documents.findForOwner(input.documentId, input.ownerId);
    if (document === null) return Result.err(new DocumentNotFoundError(input.documentId));
    if (document.state !== DocumentState.TEXT_READY) {
      return Result.err(new BookmarkTextNotReadyError(document.documentId, document.status));
    }
    const note = input.note.trim();
    if (note.length > MAX_BOOKMARK_NOTE_LENGTH) {
      return Result.err(new InvalidBookmarkNoteError(note.length, MAX_BOOKMARK_NOTE_LENGTH));
    }
    const now = this.clock.now();
    if (input.updatedAt.getTime() > now.getTime() + CLOCK_SKEW_TOLERANCE_MS) {
      return Result.err(new InvalidBookmarkTimestampError(input.updatedAt));
    }

    const existing = await this.bookmarks.findById(input.bookmarkId);
    if (existing !== null) {
      if (existing.ownerId !== input.ownerId || existing.documentId !== input.documentId) {
        return Result.err(new BookmarkIdConflictError(input.bookmarkId));
      }
      return this.edit(document, input.ownerId, input.bookmarkId, note, input.updatedAt);
    }
    return this.create(document, input, note, now);
  }

  private async create(
    document: LibraryDocument,
    input: PutBookmarkInput,
    note: string,
    now: Date,
  ): Promise<Result<{ readonly bookmark: BookmarkView; readonly created: boolean }, DomainError>> {
    const texts = await this.documents.readPageTexts(document.documentId, [input.pageNumber]);
    const text = texts.get(input.pageNumber);
    const words = text === undefined ? null : pageWords(text);
    if (words === null || input.wordIndex >= words.length) {
      return Result.err(
        new InvalidBookmarkAnchorError(input.pageNumber, input.wordIndex, words?.length ?? null),
      );
    }
    const active = await this.bookmarks.countActive(document.documentId, input.ownerId);
    if (active >= MAX_BOOKMARKS_PER_DOCUMENT) {
      return Result.err(new BookmarksLimitConflictError(MAX_BOOKMARKS_PER_DOCUMENT));
    }
    const bookmark: Bookmark = {
      id: input.bookmarkId,
      ownerId: input.ownerId,
      documentId: document.documentId,
      pageNumber: input.pageNumber,
      wordIndex: input.wordIndex,
      excerpt: excerptAt(words, input.wordIndex),
      note,
      createdAt: now,
      updatedAt: input.updatedAt,
      deletedAt: null,
    };
    if (!(await this.bookmarks.insert(bookmark))) {
      // Le même identifiant vient d'être créé par une requête rejouée : on fusionne.
      return this.edit(document, input.ownerId, input.bookmarkId, note, input.updatedAt);
    }
    return Result.ok({ bookmark: viewOf(bookmark, text), created: true });
  }

  private async edit(
    document: LibraryDocument,
    ownerId: string,
    bookmarkId: string,
    note: string,
    at: Date,
  ): Promise<Result<{ readonly bookmark: BookmarkView; readonly created: boolean }, DomainError>> {
    const kept = await this.bookmarks.applyChange(bookmarkId, ownerId, document.documentId, {
      kind: 'edit',
      note,
      at,
    });
    if (kept === null) return Result.err(new BookmarkIdConflictError(bookmarkId));
    const texts = await this.documents.readPageTexts(document.documentId, [kept.pageNumber]);
    return Result.ok({ bookmark: viewOf(kept, texts.get(kept.pageNumber)), created: false });
  }
}
