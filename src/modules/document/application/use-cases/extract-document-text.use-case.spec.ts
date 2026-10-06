import {
  FakeObjectStorage,
  FixedClock,
  InMemoryDocumentRepository,
} from '../../../../../test/support/fakes';
import {
  type Document,
  markUploaded,
  newDocumentAwaitingUpload,
} from '../../domain/entities/document.entity';
import { type PdfTextExtractorPort } from '../../domain/ports/pdf-text-extractor.port';
import { type ExtractedPageLines } from '../../domain/services/extracted-text';
import { DocumentId } from '../../domain/value-objects/document-id.vo';
import { type DocumentSize } from '../../domain/value-objects/document-size.vo';
import { DocumentStatus } from '../../domain/value-objects/document-status.vo';
import { type DocumentTitle } from '../../domain/value-objects/document-title.vo';
import { OwnerId } from '../../domain/value-objects/owner-id.vo';

import { ExtractDocumentTextUseCase } from './extract-document-text.use-case';

const NOW = new Date('2026-10-06T10:00:00Z');
const PAGE = 'Le droit constitutionnel étudie les institutions et leurs limites.'.repeat(2);

class StubExtractor implements PdfTextExtractorPort {
  calls = 0;
  constructor(public result: readonly ExtractedPageLines[] | null | Error) {}

  extract(): Promise<readonly ExtractedPageLines[] | null> {
    this.calls += 1;
    return this.result instanceof Error
      ? Promise.reject(this.result)
      : Promise.resolve(this.result);
  }
}

describe('ExtractDocumentTextUseCase', () => {
  let repo: InMemoryDocumentRepository;
  let storage: FakeObjectStorage;
  let extractor: StubExtractor;
  let useCase: ExtractDocumentTextUseCase;
  let doc: Document;

  beforeEach(async () => {
    repo = new InMemoryDocumentRepository();
    storage = new FakeObjectStorage();
    extractor = new StubExtractor([{ lines: [PAGE] }, { lines: ['Page deux :', PAGE] }]);
    useCase = new ExtractDocumentTextUseCase(repo, storage, extractor, new FixedClock(NOW));
    doc = markUploaded(
      newDocumentAwaitingUpload({
        id: DocumentId.of('01a11019-f2e7-7014-8369-af25cb7e0f0b'),
        ownerId: OwnerId.of('user-1'),
        title: 'Titre' as DocumentTitle,
        sizeBytes: 10 as DocumentSize,
        now: NOW,
      }),
      NOW,
    );
    await repo.insert(doc);
    storage.seed(doc.sourceKey, '%PDF-1.7');
  });

  it('stores the pages, marks the text ready and deletes the PDF', async () => {
    const outcome = await useCase.execute(doc.id);

    expect(outcome).toEqual({
      kind: 'text_ready',
      pageCount: 2,
      charCount: PAGE.length * 2 + 'Page deux :'.length,
    });
    expect(repo.rows.get(doc.id)).toMatchObject({
      status: DocumentStatus.TEXT_READY,
      pageCount: 2,
      sourceDeletedAt: NOW,
    });
    expect(repo.pages.get(doc.id)?.map((p) => p.pageNumber)).toEqual([1, 2]);
    expect(storage.objects.has(doc.sourceKey)).toBe(false);
  });

  it('is idempotent: a replay does not extract again', async () => {
    await useCase.execute(doc.id);
    expect(await useCase.execute(doc.id)).toEqual({ kind: 'skipped' });
    expect(extractor.calls).toBe(1);
  });

  it('finishes an interrupted PDF deletion on replay (crash after the text was saved)', async () => {
    await useCase.execute(doc.id);
    // Simule un crash entre la transaction et la suppression du PDF.
    const extracted = repo.rows.get(doc.id);
    if (extracted !== undefined) repo.rows.set(doc.id, { ...extracted, sourceDeletedAt: null });
    storage.seed(doc.sourceKey, '%PDF-1.7');

    expect(await useCase.execute(doc.id)).toEqual({ kind: 'skipped' });
    expect(storage.objects.has(doc.sourceKey)).toBe(false);
    expect(repo.rows.get(doc.id)?.sourceDeletedAt).toEqual(NOW);
  });

  it.each([
    ['scanned', [{ lines: ['12'] }]],
    ['empty', []],
    ['unreadable', null],
  ] as const)('fails as %s, without retry, and deletes the PDF', async (reason, result) => {
    extractor.result = result;
    expect(await useCase.execute(doc.id)).toEqual({ kind: 'failed', reason });
    expect(repo.rows.get(doc.id)).toMatchObject({
      status: DocumentStatus.EXTRACTION_FAILED,
      extractionError: reason,
    });
    expect(storage.objects.has(doc.sourceKey)).toBe(false);
    expect(repo.pages.has(doc.id)).toBe(false);
  });

  it('fails as source_missing when the PDF is not in storage', async () => {
    storage.objects.clear();
    expect(await useCase.execute(doc.id)).toEqual({ kind: 'failed', reason: 'source_missing' });
  });

  it('lets infrastructure failures propagate so the queue retries', async () => {
    extractor.result = new Error('worker crashed');
    await expect(useCase.execute(doc.id)).rejects.toThrow('worker crashed');
    expect(repo.rows.get(doc.id)?.status).toBe(DocumentStatus.EXTRACTING);
    storage.failing = true;
    await expect(useCase.execute(doc.id)).rejects.toMatchObject({
      code: 'INFRASTRUCTURE_STORAGE_UNAVAILABLE',
    });
  });

  it('skips unknown documents and documents still awaiting upload', async () => {
    expect(await useCase.execute(DocumentId.of('01a11019-0000-7000-8000-000000000000'))).toEqual({
      kind: 'skipped',
    });
    repo.rows.set(doc.id, { ...doc, status: DocumentStatus.AWAITING_UPLOAD });
    expect(await useCase.execute(doc.id)).toEqual({ kind: 'skipped' });
    expect(extractor.calls).toBe(0);
  });
});
