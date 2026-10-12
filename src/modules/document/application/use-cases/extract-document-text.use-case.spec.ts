import {
  FakeExtractionScheduler,
  FakeObjectStorage,
  FixedClock,
  InMemoryDocumentRepository,
} from '../../../../../test/support/fakes';
import {
  type Document,
  markUploaded,
  newDocumentAwaitingUpload,
} from '../../domain/entities/document.entity';
import { type PaidAccessPort } from '../../domain/ports/paid-access.port';
import {
  type ExtractedPdf,
  type PdfTextExtractorPort,
} from '../../domain/ports/pdf-text-extractor.port';
import { type ExtractedPageLines } from '../../domain/services/extracted-text';
import { OCR_FREE_PAGES_PER_MONTH, OCR_MAX_PAGES_PER_DOCUMENT } from '../../domain/services/ocr';
import { type OutlineEntry } from '../../domain/services/outline';
import { type ExtractedLine } from '../../domain/services/text-cleaning';
import { DocumentId } from '../../domain/value-objects/document-id.vo';
import { type DocumentSize } from '../../domain/value-objects/document-size.vo';
import { DocumentStatus, ExtractionMethod } from '../../domain/value-objects/document-status.vo';
import { type DocumentTitle } from '../../domain/value-objects/document-title.vo';
import { OwnerId } from '../../domain/value-objects/owner-id.vo';
import { ExtractionSettler } from '../services/extraction-settler.service';

import { ExtractDocumentTextUseCase } from './extract-document-text.use-case';

const NOW = new Date('2026-10-06T10:00:00Z');
const PAGE = 'Le droit constitutionnel étudie les institutions et leurs limites.'.repeat(2);

class StubExtractor implements PdfTextExtractorPort {
  calls = 0;
  constructor(public result: readonly ExtractedPageLines[] | null | Error) {}

  /** Signets rendus avec les pages (ADR-0027). */
  bookmarks: OutlineEntry[] = [];

  extract(): Promise<ExtractedPdf | null> {
    this.calls += 1;
    if (this.result instanceof Error) return Promise.reject(this.result);
    return Promise.resolve(
      this.result === null ? null : { pages: this.result, bookmarks: this.bookmarks },
    );
  }
}

class StubPaidAccess implements PaidAccessPort {
  paid = false;
  calls = 0;

  hasPaidAccess(): Promise<boolean> {
    this.calls += 1;
    return Promise.resolve(this.paid);
  }
}

/** Ligne sans position ni taille connues. */
const line = (text: string): ExtractedLine => ({ text, top: null, fontSize: null });

/** Un scan de `n` pages : quasiment aucun texte natif. */
const scan = (n: number): ExtractedPageLines[] => Array.from({ length: n }, () => ({ lines: [] }));

describe('ExtractDocumentTextUseCase', () => {
  let repo: InMemoryDocumentRepository;
  let storage: FakeObjectStorage;
  let extractor: StubExtractor;
  let scheduler: FakeExtractionScheduler;
  let paidAccess: StubPaidAccess;
  let useCase: ExtractDocumentTextUseCase;
  let doc: Document;

  beforeEach(async () => {
    repo = new InMemoryDocumentRepository();
    storage = new FakeObjectStorage();
    extractor = new StubExtractor([
      { lines: [line(PAGE)] },
      { lines: [line('Page deux :'), line(PAGE)] },
    ]);
    scheduler = new FakeExtractionScheduler();
    paidAccess = new StubPaidAccess();
    const clock = new FixedClock(NOW);
    useCase = new ExtractDocumentTextUseCase(
      repo,
      storage,
      extractor,
      scheduler,
      paidAccess,
      new ExtractionSettler(repo, storage, clock),
      clock,
    );
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
      extractionMethod: ExtractionMethod.NATIVE,
      reviewRequired: false,
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
    ['empty', []],
    ['unreadable', null],
  ] as const satisfies readonly (readonly [string, readonly ExtractedPageLines[] | null])[])(
    'fails as %s, without retry, and deletes the PDF',
    async (reason, result) => {
      extractor.result = result;
      expect(await useCase.execute(doc.id)).toEqual({ kind: 'failed', reason });
      expect(repo.rows.get(doc.id)).toMatchObject({
        status: DocumentStatus.EXTRACTION_FAILED,
        extractionError: reason,
      });
      expect(storage.objects.has(doc.sourceKey)).toBe(false);
      expect(repo.pages.has(doc.id)).toBe(false);
    },
  );

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

  describe('scanned PDF (ADR-0024)', () => {
    it('passes it to OCR from page 1 and keeps the PDF', async () => {
      extractor.result = scan(12);

      expect(await useCase.execute(doc.id)).toEqual({ kind: 'ocr_started', pageCount: 12 });
      expect(repo.rows.get(doc.id)).toMatchObject({
        status: DocumentStatus.EXTRACTING,
        extractionMethod: ExtractionMethod.OCR,
        ocrPageCount: 12,
      });
      expect(scheduler.ocrBatches).toEqual([{ documentId: doc.id, fromPage: 1 }]);
      expect(storage.objects.has(doc.sourceKey)).toBe(true);
      // Sous le plafond gratuit : `billing` n'est pas interrogé.
      expect(paidAccess.calls).toBe(0);
    });

    it('does nothing more on replay (no second count, no second batch)', async () => {
      extractor.result = scan(12);
      await useCase.execute(doc.id);

      expect(await useCase.execute(doc.id)).toEqual({ kind: 'skipped' });
      expect(extractor.calls).toBe(1);
      expect(scheduler.ocrBatches).toHaveLength(1);
    });

    it('refuses a scan over the page limit and deletes the PDF', async () => {
      extractor.result = scan(OCR_MAX_PAGES_PER_DOCUMENT + 1);

      expect(await useCase.execute(doc.id)).toEqual({
        kind: 'failed',
        reason: 'ocr_too_many_pages',
      });
      expect(storage.objects.has(doc.sourceKey)).toBe(false);
      expect(scheduler.ocrBatches).toEqual([]);
    });

    it('caps a free account per month, but not an account with a pass or credits', async () => {
      // Un scan précédent du même mois a pris tout le plafond gratuit sauf 5 pages.
      await repo.insert({
        ...doc,
        id: DocumentId.of('01a11019-f2e7-7014-8369-000000000001'),
        sourceKey: 'other',
        extractionMethod: ExtractionMethod.OCR,
        ocrPageCount: OCR_FREE_PAGES_PER_MONTH - 5,
      });
      extractor.result = scan(6);

      expect(await useCase.execute(doc.id)).toEqual({
        kind: 'failed',
        reason: 'ocr_quota_exceeded',
      });

      paidAccess.paid = true;
      repo.rows.set(doc.id, { ...doc, status: DocumentStatus.UPLOADED });
      storage.seed(doc.sourceKey, '%PDF-1.7');
      expect(await useCase.execute(doc.id)).toEqual({ kind: 'ocr_started', pageCount: 6 });
    });
  });
});
