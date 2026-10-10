import {
  FixedClock,
  ImmediateUnitOfWork,
  InMemoryFileDeletionOutbox,
} from '../../../../../test/support/fakes';
import {
  AT,
  libraryDocument,
  OWNER,
  StubLibraryConversions,
  StubLibraryDocuments,
} from '../../../../../test/support/fakes/library-stubs';

import { DeleteDocumentUseCase } from './delete-document.use-case';

describe('DeleteDocumentUseCase', () => {
  let documents: StubLibraryDocuments;
  let conversions: StubLibraryConversions;
  let outbox: InMemoryFileDeletionOutbox;
  let uow: ImmediateUnitOfWork;
  let useCase: DeleteDocumentUseCase;

  beforeEach(() => {
    documents = new StubLibraryDocuments();
    conversions = new StubLibraryConversions();
    outbox = new InMemoryFileDeletionOutbox();
    uow = new ImmediateUnitOfWork();
    useCase = new DeleteDocumentUseCase(documents, conversions, outbox, uow, new FixedClock(AT));
  });

  it('deletes the document and queues its files in the same transaction', async () => {
    documents.add(libraryDocument('d1', 0));
    conversions.cleanup = { running: false, fileKeys: ['conversions/alice/c1/manifest.json'] };

    const result = await useCase.execute({ ownerId: OWNER, documentId: 'd1' });

    expect(result.isOk() && result.value).toEqual({ fileCount: 1 });
    expect(documents.rows.has('d1')).toBe(false);
    expect([...outbox.rows.keys()]).toEqual(['conversions/alice/c1/manifest.json']);
    expect(uow.calls).toBe(1);
    expect(outbox.lastTx).toBe(ImmediateUnitOfWork.TX);
    expect(documents.deleteTx).toEqual([ImmediateUnitOfWork.TX]);
  });

  it('also queues the source PDF when it was never deleted', async () => {
    documents.add(libraryDocument('d1', 0), OWNER, false);
    await useCase.execute({ ownerId: OWNER, documentId: 'd1' });
    expect([...outbox.rows.keys()]).toEqual(['documents/alice/d1/source.pdf']);
  });

  it('409 while a conversion is running, nothing deleted', async () => {
    documents.add(libraryDocument('d1', 0));
    conversions.cleanup = { running: true, fileKeys: ['x'] };
    const result = await useCase.execute({ ownerId: OWNER, documentId: 'd1' });
    expect(result.isErr() && result.error.code).toBe('DOCUMENT_DELETION_CONFLICT');
    expect(documents.rows.has('d1')).toBe(true);
    expect(outbox.rows.size).toBe(0);
  });

  it("404 for someone else's document — checked before the 409, which would reveal it", async () => {
    documents.add(libraryDocument('d1', 0), 'bob');
    conversions.cleanup = { running: true, fileKeys: [] };
    const result = await useCase.execute({ ownerId: OWNER, documentId: 'd1' });
    expect(result.isErr() && result.error.code).toBe('DOCUMENT_NOT_FOUND');
    expect(documents.rows.has('d1')).toBe(true);
  });

  it('404 when replayed after a successful deletion', async () => {
    documents.add(libraryDocument('d1', 0));
    await useCase.execute({ ownerId: OWNER, documentId: 'd1' });
    const replay = await useCase.execute({ ownerId: OWNER, documentId: 'd1' });
    expect(replay.isErr() && replay.error.code).toBe('DOCUMENT_NOT_FOUND');
  });
});
