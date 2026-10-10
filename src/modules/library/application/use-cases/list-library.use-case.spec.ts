import { createCursorCodec, type CursorEncoder } from '@/shared/kernel';

import { InMemoryReadingPositionRepository } from '../../../../../test/support/fakes';
import {
  AT,
  libraryConversion,
  libraryDocument,
  OWNER,
  StubLibraryConversions,
  StubLibraryDocuments,
} from '../../../../../test/support/fakes/library-stubs';
import {
  ConversionState,
  DocumentState,
  LibraryItemStatus,
} from '../../domain/value-objects/library-item-status.vo';

import { ListLibraryUseCase } from './list-library.use-case';

describe('ListLibraryUseCase', () => {
  let documents: StubLibraryDocuments;
  let conversions: StubLibraryConversions;
  let positions: InMemoryReadingPositionRepository;
  let cursors: CursorEncoder<string>;
  let useCase: ListLibraryUseCase;

  beforeEach(() => {
    documents = new StubLibraryDocuments();
    conversions = new StubLibraryConversions();
    positions = new InMemoryReadingPositionRepository();
    cursors = createCursorCodec<string>('s'.repeat(32));
    useCase = new ListLibraryUseCase(documents, conversions, positions, cursors);
  });

  async function list(cursor?: string, limit?: number) {
    const result = await useCase.execute({ ownerId: OWNER, cursor, limit });
    if (result.isErr()) throw result.error;
    return result.value;
  }

  it('composes each book with its conversion, position and derived status, newest first', async () => {
    documents.add(libraryDocument('d1', 0));
    documents.add(libraryDocument('d2', 1));
    documents.add(
      libraryDocument('d3', 2, { status: 'extracting', state: DocumentState.PROCESSING }),
    );
    conversions.add(libraryConversion('c1', 'd1'));
    conversions.add(
      libraryConversion('c2', 'd2', { status: 'synthesizing', state: ConversionState.PROCESSING }),
    );
    await positions.saveIfNewer({
      conversionId: 'c1',
      ownerId: OWNER,
      wordIndex: 499,
      audioMs: 300_000,
      recordedAt: AT,
      updatedAt: AT,
    });

    const page = await list();
    expect(page.items.map((i) => [i.document.documentId, i.status, i.progressPercent])).toEqual([
      ['d3', LibraryItemStatus.PROCESSING, null],
      ['d2', LibraryItemStatus.PROCESSING, null],
      ['d1', LibraryItemStatus.IN_PROGRESS, 50],
    ]);
    expect(page.items[2]?.position?.wordIndex).toBe(499);
    expect(page.nextCursor).toBeNull();
    // Une seule lecture des conversions pour toute la page (pas de N+1).
    expect(conversions.requestedDocumentIds).toEqual([['d3', 'd2', 'd1']]);
  });

  it('paginates with a signed cursor and rejects a forged one', async () => {
    for (let i = 0; i < 3; i += 1) documents.add(libraryDocument(`d${String(i)}`, i));
    const first = await list(undefined, 2);
    expect(first.items.map((i) => i.document.documentId)).toEqual(['d2', 'd1']);
    expect(first.nextCursor).not.toBeNull();
    const second = await list(first.nextCursor ?? undefined, 2);
    expect(second.items.map((i) => i.document.documentId)).toEqual(['d0']);
    expect(second.nextCursor).toBeNull();

    const forged = await useCase.execute({ ownerId: OWNER, cursor: 'not-a-cursor' });
    expect(forged.isErr() && forged.error.code).toBe('INVALID_CURSOR');
  });

  it("never shows another user's books", async () => {
    documents.add(libraryDocument('mine', 0));
    documents.add(libraryDocument('theirs', 1), 'bob');
    const page = await list();
    expect(page.items.map((i) => i.document.documentId)).toEqual(['mine']);
  });
});
