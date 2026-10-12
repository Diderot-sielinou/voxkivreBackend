import { DomainError } from '@/shared/kernel';

import { LIBRARY_ERROR_CODES } from './error-codes';

/** Note trop longue (422, ADR-0028 §6). */
export class InvalidBookmarkNoteError extends DomainError {
  readonly code = LIBRARY_ERROR_CODES.INVALID_BOOKMARK_NOTE;

  constructor(length: number, maxLength: number) {
    super(`Bookmark note is too long (${String(length)} > ${String(maxLength)})`, {
      details: { length, maxLength },
    });
  }
}

/** Page inexistante ou mot hors de la page (422). */
export class InvalidBookmarkAnchorError extends DomainError {
  readonly code = LIBRARY_ERROR_CODES.INVALID_BOOKMARK_ANCHOR;

  constructor(pageNumber: number, wordIndex: number, wordCount: number | null) {
    super(`No word ${String(wordIndex)} on page ${String(pageNumber)}`, {
      details: { pageNumber, wordIndex, wordCount },
    });
  }
}

/** Instant de modification dans le futur au-delà de la dérive tolérée (422). */
export class InvalidBookmarkTimestampError extends DomainError {
  readonly code = LIBRARY_ERROR_CODES.INVALID_BOOKMARK_TIMESTAMP;

  constructor(at: Date) {
    super('Bookmark change is dated in the future', { details: { at: at.toISOString() } });
  }
}

/** Maximum de marque-pages atteint pour ce document (409). */
export class BookmarksLimitConflictError extends DomainError {
  readonly code = LIBRARY_ERROR_CODES.BOOKMARKS_LIMIT_CONFLICT;

  constructor(maxBookmarks: number) {
    super(`A document holds at most ${String(maxBookmarks)} bookmarks`, {
      details: { maxBookmarks },
    });
  }
}

/** L'identifiant existe déjà pour un autre document ou un autre compte (409). */
export class BookmarkIdConflictError extends DomainError {
  readonly code = LIBRARY_ERROR_CODES.BOOKMARK_ID_CONFLICT;

  constructor(bookmarkId: string) {
    super(`Bookmark ${bookmarkId} belongs elsewhere`, { details: { bookmarkId } });
  }
}

/** Le texte n'est pas (encore) prêt : pas de marque-page (409, même code que `document`). */
export class BookmarkTextNotReadyError extends DomainError {
  readonly code = LIBRARY_ERROR_CODES.DOCUMENT_TEXT_NOT_READY;

  constructor(documentId: string, status: string) {
    super(`Text of document ${documentId} is not ready (status: ${status})`, {
      details: { documentId, status },
    });
  }
}
