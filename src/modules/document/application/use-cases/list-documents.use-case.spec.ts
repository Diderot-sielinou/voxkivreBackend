import { createCursorCodec, ERROR_CODES, uuidV7 } from '@/shared/kernel';

import { InMemoryDocumentRepository } from '../../../../../test/support/fakes';
import { markUploaded, newDocumentAwaitingUpload } from '../../domain/entities/document.entity';
import { DocumentId } from '../../domain/value-objects/document-id.vo';
import { type DocumentSize } from '../../domain/value-objects/document-size.vo';
import { type DocumentTitle } from '../../domain/value-objects/document-title.vo';
import { OwnerId } from '../../domain/value-objects/owner-id.vo';

import { DOCUMENT_PAGE_MAX_LIMIT, ListDocumentsUseCase } from './list-documents.use-case';

const OWNER = OwnerId.of('user-1');
const codec = createCursorCodec<string>('s'.repeat(32));

async function seed(repo: InMemoryDocumentRepository, count: number, ownerId = OWNER) {
  for (let i = 0; i < count; i += 1) {
    const created = new Date(Date.UTC(2026, 9, 1, 0, i));
    const doc = newDocumentAwaitingUpload({
      id: DocumentId.of(uuidV7()),
      ownerId,
      title: `Doc ${String(i)}` as DocumentTitle,
      sizeBytes: 10 as DocumentSize,
      now: created,
    });
    await repo.insert(markUploaded(doc, created));
  }
}

describe('ListDocumentsUseCase', () => {
  let repo: InMemoryDocumentRepository;
  let useCase: ListDocumentsUseCase;

  beforeEach(() => {
    repo = new InMemoryDocumentRepository();
    useCase = new ListDocumentsUseCase(repo, codec);
  });

  it('walks every page newest-first with no duplicate nor gap', async () => {
    await seed(repo, 5);
    const titles: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const result = await useCase.execute({ ownerId: OWNER, cursor, limit: 2 });
      const page = result.value;
      titles.push(...page.items.map((d) => d.title));
      cursor = page.nextCursor ?? undefined;
      pages += 1;
    } while (cursor !== undefined);
    expect(pages).toBe(3);
    expect(titles).toEqual(['Doc 4', 'Doc 3', 'Doc 2', 'Doc 1', 'Doc 0']);
  });

  it('excludes awaiting_upload documents and other owners', async () => {
    await seed(repo, 1);
    await seed(repo, 2, OwnerId.of('someone-else'));
    await repo.insert(
      newDocumentAwaitingUpload({
        id: DocumentId.of(uuidV7()),
        ownerId: OWNER,
        title: 'pending' as DocumentTitle,
        sizeBytes: 1 as DocumentSize,
        now: new Date(),
      }),
    );
    const result = await useCase.execute({ ownerId: OWNER });
    const page = result.value;
    expect(page.items.map((d) => d.title)).toEqual(['Doc 0']);
    expect(page.nextCursor).toBeNull();
  });

  it('clamps the limit to [1, max]', async () => {
    await seed(repo, DOCUMENT_PAGE_MAX_LIMIT + 5);
    const capped = await useCase.execute({ ownerId: OWNER, limit: 500 });
    const floored = await useCase.execute({ ownerId: OWNER, limit: 0 });
    expect(capped.value.items).toHaveLength(DOCUMENT_PAGE_MAX_LIMIT);
    expect(floored.value.items).toHaveLength(1);
  });

  it.each([
    ['a forged cursor', 'abc.def'],
    [
      'a cursor signed with another secret',
      createCursorCodec<string>('o'.repeat(32)).encode('2026-10-01T00:00:00.000Z', 'x'),
    ],
    ['a signed cursor whose sort key is not a date', codec.encode('not-a-date', 'x')],
  ])('rejects %s with INVALID_CURSOR', async (_label, cursor) => {
    const r = await useCase.execute({ ownerId: OWNER, cursor });
    expect(r.error.code).toBe(ERROR_CODES.INVALID_CURSOR);
  });
});
