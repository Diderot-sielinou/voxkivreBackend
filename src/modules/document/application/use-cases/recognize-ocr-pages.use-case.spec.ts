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
import { type OcrPort } from '../../domain/ports/ocr.port';
import { OCR_BATCH_PAGES, type OcrPage } from '../../domain/services/ocr';
import { DocumentId } from '../../domain/value-objects/document-id.vo';
import { type DocumentSize } from '../../domain/value-objects/document-size.vo';
import { DocumentStatus, ExtractionMethod } from '../../domain/value-objects/document-status.vo';
import { type DocumentTitle } from '../../domain/value-objects/document-title.vo';
import { OwnerId } from '../../domain/value-objects/owner-id.vo';
import { ExtractionSettler } from '../services/extraction-settler.service';

import { RecognizeOcrPagesUseCase } from './recognize-ocr-pages.use-case';

const NOW = new Date('2026-10-12T10:00:00Z');

/** OCR scripté : une ligne de corps par page, confiance réglable par page. */
class StubOcr implements OcrPort {
  readonly calls: (readonly [number, number])[] = [];
  confidenceOf: (page: number) => number | null = () => 0.95;
  result: 'pages' | 'unreadable' | Error = 'pages';

  recognizePages(
    _pdf: Uint8Array,
    first: number,
    last: number,
  ): Promise<readonly OcrPage[] | null> {
    this.calls.push([first, last]);
    if (this.result instanceof Error) return Promise.reject(this.result);
    if (this.result === 'unreadable') return Promise.resolve(null);
    const pages: OcrPage[] = [];
    for (let n = first; n <= last; n += 1) {
      const confidence = this.confidenceOf(n);
      pages.push({
        pageNumber: n,
        lines:
          confidence === null
            ? []
            : [{ text: `Texte reconnu de la page ${String(n)}.`, top: 0.3, fontSize: 11 }],
        confidence,
      });
    }
    return Promise.resolve(pages);
  }
}

describe('RecognizeOcrPagesUseCase', () => {
  let repo: InMemoryDocumentRepository;
  let storage: FakeObjectStorage;
  let ocr: StubOcr;
  let scheduler: FakeExtractionScheduler;
  let useCase: RecognizeOcrPagesUseCase;
  let doc: Document;

  /** Document passé à l'OCR (`extract-text` déjà fait), `pageCount` pages. */
  async function scanned(pageCount: number): Promise<void> {
    doc = {
      ...markUploaded(
        newDocumentAwaitingUpload({
          id: DocumentId.of('01a11019-f2e7-7014-8369-af25cb7e0f0b'),
          ownerId: OwnerId.of('user-1'),
          title: 'Cours scanné' as DocumentTitle,
          sizeBytes: 10 as DocumentSize,
          now: NOW,
        }),
        NOW,
      ),
      status: DocumentStatus.EXTRACTING,
      extractionMethod: ExtractionMethod.OCR,
      ocrPageCount: pageCount,
    };
    await repo.insert(doc);
    storage.seed(doc.sourceKey, '%PDF-1.7');
  }

  beforeEach(() => {
    repo = new InMemoryDocumentRepository();
    storage = new FakeObjectStorage();
    ocr = new StubOcr();
    scheduler = new FakeExtractionScheduler();
    const clock = new FixedClock(NOW);
    useCase = new RecognizeOcrPagesUseCase(
      repo,
      storage,
      ocr,
      scheduler,
      new ExtractionSettler(repo, storage, clock),
      clock,
    );
  });

  it('recognises one batch, stores it and queues the next batch at the end of the queue', async () => {
    await scanned(25);

    expect(await useCase.execute(doc.id, 1)).toEqual({
      kind: 'batch_done',
      lastPage: OCR_BATCH_PAGES,
      pageCount: 25,
    });
    expect(ocr.calls).toEqual([[1, OCR_BATCH_PAGES]]);
    expect(await repo.listOcrPageNumbers(doc.id)).toHaveLength(OCR_BATCH_PAGES);
    expect(scheduler.ocrBatches).toEqual([{ documentId: doc.id, fromPage: 11 }]);
    expect(storage.objects.has(doc.sourceKey)).toBe(true);
  });

  it('assembles the whole text on the last batch, then deletes the PDF', async () => {
    await scanned(25);
    await useCase.execute(doc.id, 1);
    await useCase.execute(doc.id, 11);

    const outcome = await useCase.execute(doc.id, 21);

    expect(outcome).toMatchObject({ kind: 'text_ready', pageCount: 25, reviewRequired: false });
    expect(repo.rows.get(doc.id)).toMatchObject({
      status: DocumentStatus.TEXT_READY,
      extractionMethod: ExtractionMethod.OCR,
      reviewRequired: false,
      pageCount: 25,
    });
    expect(repo.pages.get(doc.id)?.[0]).toMatchObject({
      text: 'Texte reconnu de la page 1.',
      ocrConfidence: 0.95,
    });
    expect(repo.ocrPages.has(doc.id)).toBe(false);
    expect(storage.objects.has(doc.sourceKey)).toBe(false);
  });

  it('requires a review when one page is under the confidence threshold', async () => {
    ocr.confidenceOf = (page) => (page === 2 ? 0.62 : 0.97);
    await scanned(3);

    expect(await useCase.execute(doc.id, 1)).toMatchObject({
      kind: 'text_ready',
      reviewRequired: true,
    });
    expect(repo.rows.get(doc.id)?.reviewRequired).toBe(true);
  });

  it('does not recognise a batch twice on replay, and resumes from the first missing page', async () => {
    await scanned(25);
    await useCase.execute(doc.id, 1);
    // Le lot 11–20 a été perdu ; le lot 21–25 tourne quand même.
    await useCase.execute(doc.id, 21);
    expect(scheduler.ocrBatches.at(-1)).toEqual({ documentId: doc.id, fromPage: 11 });

    // Rejeu du premier lot : rien n'est reconnu à nouveau.
    await useCase.execute(doc.id, 1);
    expect(ocr.calls).toEqual([
      [1, 10],
      [21, 25],
    ]);
    expect(scheduler.ocrBatches.at(-1)).toEqual({ documentId: doc.id, fromPage: 11 });

    expect(await useCase.execute(doc.id, 11)).toMatchObject({ kind: 'text_ready' });
  });

  it('fails as ocr_no_text when no word was recognised on any page', async () => {
    ocr.confidenceOf = () => null;
    await scanned(2);

    expect(await useCase.execute(doc.id, 1)).toEqual({ kind: 'failed', reason: 'ocr_no_text' });
    expect(repo.rows.get(doc.id)).toMatchObject({
      status: DocumentStatus.EXTRACTION_FAILED,
      extractionError: 'ocr_no_text',
    });
    expect(storage.objects.has(doc.sourceKey)).toBe(false);
  });

  it.each([
    ['source_missing', 'missing'],
    ['unreadable', 'unreadable'],
  ] as const)('fails as %s, deletes what is left and stores nothing', async (reason, cause) => {
    await scanned(5);
    if (cause === 'missing') storage.objects.clear();
    else ocr.result = 'unreadable';

    expect(await useCase.execute(doc.id, 1)).toEqual({ kind: 'failed', reason });
    expect(repo.rows.get(doc.id)?.status).toBe(DocumentStatus.EXTRACTION_FAILED);
    expect(repo.ocrPages.has(doc.id)).toBe(false);
  });

  it('lets an OCR crash propagate so the queue retries the batch', async () => {
    await scanned(5);
    ocr.result = new Error('tesseract killed');

    await expect(useCase.execute(doc.id, 1)).rejects.toThrow('tesseract killed');
    expect(repo.rows.get(doc.id)?.status).toBe(DocumentStatus.EXTRACTING);
  });

  it('skips a document that is not under OCR, or a page out of range', async () => {
    await scanned(5);
    expect(await useCase.execute(doc.id, 6)).toEqual({ kind: 'skipped' });
    expect(await useCase.execute(doc.id, 0)).toEqual({ kind: 'skipped' });

    repo.rows.set(doc.id, { ...doc, extractionMethod: null });
    expect(await useCase.execute(doc.id, 1)).toEqual({ kind: 'skipped' });
    expect(await useCase.execute(DocumentId.of('01a11019-0000-7000-8000-000000000000'), 1)).toEqual(
      { kind: 'skipped' },
    );
    expect(ocr.calls).toEqual([]);
  });

  it('only finishes an interrupted PDF deletion once the text is ready', async () => {
    await scanned(2);
    await useCase.execute(doc.id, 1);
    const ready = repo.rows.get(doc.id);
    if (ready !== undefined) repo.rows.set(doc.id, { ...ready, sourceDeletedAt: null });
    storage.seed(doc.sourceKey, '%PDF-1.7');

    expect(await useCase.execute(doc.id, 1)).toEqual({ kind: 'skipped' });
    expect(storage.objects.has(doc.sourceKey)).toBe(false);
  });
});
