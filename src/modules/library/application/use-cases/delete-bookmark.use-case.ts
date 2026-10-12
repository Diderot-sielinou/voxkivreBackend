import { Inject, Injectable } from '@nestjs/common';

import { CLOCK, type ClockPort, type DomainError, Result } from '@/shared/kernel';

import { DocumentNotFoundError } from '../../domain/errors/document-not-found.error';
import { InvalidBookmarkTimestampError } from '../../domain/errors/invalid-bookmark.error';
import {
  BOOKMARK_REPOSITORY,
  type BookmarkRepositoryPort,
} from '../../domain/ports/bookmark-repository.port';
import {
  LIBRARY_DOCUMENTS,
  type LibraryDocumentsPort,
} from '../../domain/ports/library-documents.port';
import { CLOCK_SKEW_TOLERANCE_MS } from '../../domain/services/reading-position-policy';

/**
 * `DELETE /v1/documents/:id/bookmarks/:bookmarkId` (ADR-0028 §3) : garde une
 * trace de suppression datée par l'appareil ; une modification plus récente
 * l'emporte, une plus ancienne ne fait pas réapparaître le marque-page.
 * Idempotent ; un identifiant inconnu est sans effet.
 */
@Injectable()
export class DeleteBookmarkUseCase {
  constructor(
    @Inject(BOOKMARK_REPOSITORY) private readonly bookmarks: BookmarkRepositoryPort,
    @Inject(LIBRARY_DOCUMENTS) private readonly documents: LibraryDocumentsPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
  ) {}

  async execute(input: {
    readonly ownerId: string;
    readonly documentId: string;
    readonly bookmarkId: string;
    readonly deletedAt: Date;
  }): Promise<Result<void, DomainError>> {
    const document = await this.documents.findForOwner(input.documentId, input.ownerId);
    if (document === null) return Result.err(new DocumentNotFoundError(input.documentId));
    if (input.deletedAt.getTime() > this.clock.now().getTime() + CLOCK_SKEW_TOLERANCE_MS) {
      return Result.err(new InvalidBookmarkTimestampError(input.deletedAt));
    }
    await this.bookmarks.applyChange(input.bookmarkId, input.ownerId, document.documentId, {
      kind: 'delete',
      at: input.deletedAt,
    });
    return Result.ok();
  }
}
