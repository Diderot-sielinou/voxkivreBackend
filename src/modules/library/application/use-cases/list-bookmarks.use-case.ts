import { Inject, Injectable } from '@nestjs/common';

import { type DomainError, Result } from '@/shared/kernel';

import { DocumentNotFoundError } from '../../domain/errors/document-not-found.error';
import { BookmarkTextNotReadyError } from '../../domain/errors/invalid-bookmark.error';
import {
  BOOKMARK_REPOSITORY,
  type BookmarkRepositoryPort,
} from '../../domain/ports/bookmark-repository.port';
import {
  LIBRARY_DOCUMENTS,
  type LibraryDocumentsPort,
} from '../../domain/ports/library-documents.port';
import { type BookmarkView, viewOf } from '../../domain/services/bookmark-anchor';
import { DocumentState } from '../../domain/value-objects/library-item-status.vo';

/**
 * `GET /v1/documents/:id/bookmarks` (RF-27, ADR-0028) : marque-pages actifs,
 * triés par page puis mot, ancrage vérifié sur le texte courant (une
 * lecture des pages concernées, pas une par marque-page).
 */
@Injectable()
export class ListBookmarksUseCase {
  constructor(
    @Inject(BOOKMARK_REPOSITORY) private readonly bookmarks: BookmarkRepositoryPort,
    @Inject(LIBRARY_DOCUMENTS) private readonly documents: LibraryDocumentsPort,
  ) {}

  async execute(input: {
    readonly ownerId: string;
    readonly documentId: string;
  }): Promise<Result<readonly BookmarkView[], DomainError>> {
    const document = await this.documents.findForOwner(input.documentId, input.ownerId);
    if (document === null) return Result.err(new DocumentNotFoundError(input.documentId));
    if (document.state !== DocumentState.TEXT_READY) {
      return Result.err(new BookmarkTextNotReadyError(document.documentId, document.status));
    }
    const active = await this.bookmarks.listActive(document.documentId, input.ownerId);
    const pages = [...new Set(active.map((bookmark) => bookmark.pageNumber))];
    const texts = await this.documents.readPageTexts(document.documentId, pages);
    return Result.ok(active.map((bookmark) => viewOf(bookmark, texts.get(bookmark.pageNumber))));
  }
}
