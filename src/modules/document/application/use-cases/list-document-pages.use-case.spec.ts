import { createCursorCodec, ERROR_CODES } from '@/shared/kernel';

import { InMemoryDocumentRepository } from '../../../../../test/support/fakes';
import { markUploaded, newDocumentAwaitingUpload } from '../../domain/entities/document.entity';
import { DOCUMENT_ERROR_CODES } from '../../domain/errors/error-codes';
import { DocumentId } from '../../domain/value-objects/document-id.vo';
import { type DocumentSize } from '../../domain/value-objects/document-size.vo';
import { DocumentStatus } from '../../domain/value-objects/document-status.vo';
import { type DocumentTitle } from '../../domain/value-objects/document-title.vo';
import { OwnerId } from '../../domain/value-objects/owner-id.vo';

import { ListDocumentPagesUseCase, PAGES_MAX_LIMIT } from './list-document-pages.use-case';

const NOW = new Date('2026-10-06T10:00:00Z');
const OWNER = OwnerId.of('user-1');
const codec = createCursorCodec<string>('s'.repeat(32));

async function seed(repo: InMemoryDocumentRepository, id: string, pageCount: number) {
  const doc = markUploaded(
    newDocumentAwaitingUpload({
      id: DocumentId.of(id),
      ownerId: OWNER,
      title: 'x' as DocumentTitle,
      sizeBytes: 1 as DocumentSize,
      now: NOW,
    }),
    NOW,
  );
  await repo.insert({ ...doc, status: DocumentStatus.EXTRACTING });
  await repo.completeExtraction(
    doc.id,
    Array.from({ length: pageCount }, (_, i) => ({
      pageNumber: i + 1,
      text: `page ${String(i + 1)}`,
      charCount: 6,
    })),
    pageCount * 6,
    NOW,
  );
  return doc.id;
}

describe('ListDocumentPagesUseCase', () => {
  let repo: InMemoryDocumentRepository;
  let useCase: ListDocumentPagesUseCase;

  beforeEach(() => {
    repo = new InMemoryDocumentRepository();
    useCase = new ListDocumentPagesUseCase(repo, codec);
  });

  it('walks all pages in order with the cursor', async () => {
    const id = await seed(repo, 'doc-a', 5);
    const seen: number[] = [];
    let cursor: string | undefined;
    do {
      const result = await useCase.execute({ ownerId: OWNER, documentId: id, cursor, limit: 2 });
      seen.push(...result.value.items.map((p) => p.pageNumber));
      cursor = result.value.nextCursor ?? undefined;
    } while (cursor !== undefined);
    expect(seen).toEqual([1, 2, 3, 4, 5]);
  });

  it('caps the limit', async () => {
    const id = await seed(repo, 'doc-a', PAGES_MAX_LIMIT + 3);
    const result = await useCase.execute({ ownerId: OWNER, documentId: id, limit: 999 });
    expect(result.value.items).toHaveLength(PAGES_MAX_LIMIT);
  });

  it('rejects a cursor issued for another document', async () => {
    const a = await seed(repo, 'doc-a', 3);
    const b = await seed(repo, 'doc-b', 3);
    const first = await useCase.execute({ ownerId: OWNER, documentId: a, limit: 1 });
    const crossed = await useCase.execute({
      ownerId: OWNER,
      documentId: b,
      cursor: first.value.nextCursor ?? '',
    });
    expect(crossed.error.code).toBe(ERROR_CODES.INVALID_CURSOR);
  });

  it('answers 404 for another owner and 409 while the text is not ready', async () => {
    const id = await seed(repo, 'doc-a', 1);
    const other = await useCase.execute({ ownerId: OwnerId.of('intruder'), documentId: id });
    expect(other.error.code).toBe(DOCUMENT_ERROR_CODES.DOCUMENT_NOT_FOUND);

    const doc = repo.rows.get(id);
    if (doc !== undefined) repo.rows.set(id, { ...doc, status: DocumentStatus.EXTRACTING });
    const notReady = await useCase.execute({ ownerId: OWNER, documentId: id });
    expect(notReady.error.code).toBe(DOCUMENT_ERROR_CODES.DOCUMENT_TEXT_NOT_READY);
    expect(notReady.error.details).toMatchObject({ status: 'extracting' });
  });
});
