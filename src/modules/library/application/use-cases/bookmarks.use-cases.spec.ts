import { FixedClock, InMemoryBookmarkRepository } from '../../../../../test/support/fakes';
import {
  libraryDocument,
  OWNER,
  StubLibraryDocuments,
} from '../../../../../test/support/fakes/library-stubs';
import { LIBRARY_ERROR_CODES } from '../../domain/errors/error-codes';
import {
  MAX_BOOKMARK_NOTE_LENGTH,
  MAX_BOOKMARKS_PER_DOCUMENT,
} from '../../domain/services/bookmark-policy';
import { DocumentState } from '../../domain/value-objects/library-item-status.vo';

import { DeleteBookmarkUseCase } from './delete-bookmark.use-case';
import { ListBookmarksUseCase } from './list-bookmarks.use-case';
import { PutBookmarkUseCase } from './put-bookmark.use-case';

const DOC = '01a11019-f2e7-7014-8369-af25cb7e0f0b';
const NOW = new Date('2026-10-12T12:00:00Z');
const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000);
const ID_A = '01a11019-0000-7000-8000-00000000000a';
const ID_B = '01a11019-0000-7000-8000-00000000000b';
const PAGE_1 = 'Le contrat est un accord de volontés destiné à créer des obligations.';
const PAGE_2 = 'Sa validité suppose le consentement des parties et leur capacité.';

describe('bookmarks use-cases (ADR-0028)', () => {
  let repo: InMemoryBookmarkRepository;
  let documents: StubLibraryDocuments;
  let put: PutBookmarkUseCase;
  let list: ListBookmarksUseCase;
  let remove: DeleteBookmarkUseCase;

  beforeEach(() => {
    repo = new InMemoryBookmarkRepository();
    documents = new StubLibraryDocuments();
    documents.add(libraryDocument(DOC, 0));
    documents.setPageText(DOC, 1, PAGE_1);
    documents.setPageText(DOC, 2, PAGE_2);
    const clock = new FixedClock(NOW);
    put = new PutBookmarkUseCase(repo, documents, clock);
    list = new ListBookmarksUseCase(repo, documents);
    remove = new DeleteBookmarkUseCase(repo, documents, clock);
  });

  const putAt = (id: string, note: string, at: Date, pageNumber = 2, wordIndex = 3) =>
    put.execute({
      ownerId: OWNER,
      documentId: DOC,
      bookmarkId: id,
      pageNumber,
      wordIndex,
      note,
      updatedAt: at,
    });
  const listed = async () => {
    const result = await list.execute({ ownerId: OWNER, documentId: DOC });
    return result.value;
  };

  it('creates a bookmark on the document text, with an excerpt and the note', async () => {
    const result = await putAt(ID_A, '  À relire avant l’examen  ', minutes(-5));

    expect(result.value).toMatchObject({
      created: true,
      bookmark: {
        id: ID_A,
        pageNumber: 2,
        wordIndex: 3,
        excerpt: 'le consentement des parties et leur',
        note: 'À relire avant l’examen',
        needsReview: false,
        deletedAt: null,
      },
    });
  });

  describe('sync between devices', () => {
    it('keeps both bookmarks created offline on two devices', async () => {
      await putAt(ID_A, 'Appareil A', minutes(-30), 1, 0);
      await putAt(ID_B, 'Appareil B', minutes(-20), 2, 0);

      const items = await listed();

      expect(items.map((b) => [b.id, b.note])).toEqual([
        [ID_A, 'Appareil A'],
        [ID_B, 'Appareil B'],
      ]);
    });

    it('keeps the latest note when the same bookmark is edited on two devices', async () => {
      await putAt(ID_A, 'Création', minutes(-30));
      await putAt(ID_A, 'Modifiée sur A', minutes(-10));
      const late = await putAt(ID_A, 'Modifiée sur B, plus tôt', minutes(-20));

      expect(late.value).toMatchObject({ created: false, bookmark: { note: 'Modifiée sur A' } });
      const items = await listed();
      expect(items.map((b) => b.note)).toEqual(['Modifiée sur A']);
    });

    it('does not bring back a bookmark deleted on A when B syncs an older edit', async () => {
      await putAt(ID_A, 'Création', minutes(-30));
      await remove.execute({
        ownerId: OWNER,
        documentId: DOC,
        bookmarkId: ID_A,
        deletedAt: minutes(-10),
      });

      // B était hors ligne : sa modification date d'avant la suppression.
      const sync = await putAt(ID_A, 'Modifiée sur B hors ligne', minutes(-20));

      expect(sync.value.bookmark.deletedAt).toEqual(minutes(-10));
      expect(await listed()).toEqual([]);
    });

    it('brings it back when the edit is more recent than the deletion', async () => {
      await putAt(ID_A, 'Création', minutes(-30));
      await remove.execute({
        ownerId: OWNER,
        documentId: DOC,
        bookmarkId: ID_A,
        deletedAt: minutes(-20),
      });
      await putAt(ID_A, 'Rétabli', minutes(-10));

      const items = await listed();

      expect(items.map((b) => b.note)).toEqual(['Rétabli']);
    });

    it('ignores a deletion of an unknown bookmark, and an older one', async () => {
      await putAt(ID_A, 'Création', minutes(-10));
      const unknown = await remove.execute({
        ownerId: OWNER,
        documentId: DOC,
        bookmarkId: ID_B,
        deletedAt: minutes(-5),
      });
      await remove.execute({
        ownerId: OWNER,
        documentId: DOC,
        bookmarkId: ID_A,
        deletedAt: minutes(-20),
      });

      expect(unknown.isOk()).toBe(true);
      expect(await listed()).toHaveLength(1);
    });
  });

  it('finds the anchor again after the page text changed, and flags a lost one', async () => {
    await putAt(ID_A, 'Ancré', minutes(-10), 2, 3);
    await putAt(ID_B, 'Perdu', minutes(-10), 1, 2);
    documents.setPageText(DOC, 2, `Paiement , 2 ans , 2272 ${PAGE_2}`);
    documents.setPageText(DOC, 1, 'Page entièrement réécrite.');

    const items = await listed();

    expect(items.map((b) => [b.note, b.wordIndex, b.needsReview])).toEqual([
      ['Perdu', 2, true],
      ['Ancré', 9, false],
    ]);
  });

  describe('errors (never 500)', () => {
    it('refuses a note over the limit (422)', async () => {
      const result = await putAt(ID_A, 'x'.repeat(MAX_BOOKMARK_NOTE_LENGTH + 1), minutes(-1));
      expect(result.error.code).toBe(LIBRARY_ERROR_CODES.INVALID_BOOKMARK_NOTE);
    });

    it('refuses an anchor out of the page or a missing page (422)', async () => {
      const outsidePage = await putAt(ID_A, '', minutes(-1), 2, 99);
      const missingPage = await putAt(ID_A, '', minutes(-1), 7, 0);
      expect(outsidePage.error.code).toBe(LIBRARY_ERROR_CODES.INVALID_BOOKMARK_ANCHOR);
      expect(missingPage.error.code).toBe(LIBRARY_ERROR_CODES.INVALID_BOOKMARK_ANCHOR);
    });

    it('refuses a change dated in the future beyond the clock drift (422)', async () => {
      const result = await putAt(ID_A, '', minutes(6));
      expect(result.error.code).toBe(LIBRARY_ERROR_CODES.INVALID_BOOKMARK_TIMESTAMP);
    });

    it('refuses a new bookmark once the document holds the maximum (409)', async () => {
      for (let i = 0; i < MAX_BOOKMARKS_PER_DOCUMENT; i += 1) {
        await repo.insert({
          id: `00000000-0000-7000-8000-${String(i).padStart(12, '0')}`,
          ownerId: OWNER,
          documentId: DOC,
          pageNumber: 1,
          wordIndex: 0,
          excerpt: 'Le',
          note: '',
          createdAt: NOW,
          updatedAt: NOW,
          deletedAt: null,
        });
      }
      const overLimit = await putAt(ID_A, '', minutes(-1));
      expect(overLimit.error.code).toBe(LIBRARY_ERROR_CODES.BOOKMARKS_LIMIT_CONFLICT);
    });

    it('answers 404 for another owner, 409 before the text is ready or for a foreign id', async () => {
      const foreign = await put.execute({
        ownerId: 'bob',
        documentId: DOC,
        bookmarkId: ID_A,
        pageNumber: 1,
        wordIndex: 0,
        note: '',
        updatedAt: minutes(-1),
      });
      expect(foreign.error.code).toBe(LIBRARY_ERROR_CODES.DOCUMENT_NOT_FOUND);

      await putAt(ID_A, '', minutes(-2));
      const other = '01a11019-f2e7-7014-8369-000000000002';
      documents.add(libraryDocument(other, 1));
      documents.setPageText(other, 1, PAGE_1);
      const reused = await put.execute({
        ownerId: OWNER,
        documentId: other,
        bookmarkId: ID_A,
        pageNumber: 1,
        wordIndex: 0,
        note: '',
        updatedAt: minutes(-1),
      });
      expect(reused.error.code).toBe(LIBRARY_ERROR_CODES.BOOKMARK_ID_CONFLICT);

      documents.add(
        libraryDocument('01a11019-f2e7-7014-8369-000000000003', 2, {
          status: 'extracting',
          state: DocumentState.PROCESSING,
        }),
      );
      const early = await list.execute({
        ownerId: OWNER,
        documentId: '01a11019-f2e7-7014-8369-000000000003',
      });
      expect(early.error.code).toBe(LIBRARY_ERROR_CODES.DOCUMENT_TEXT_NOT_READY);
    });
  });
});
