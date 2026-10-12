import {
  FakeExtractionScheduler,
  FixedClock,
  InMemoryDocumentRepository,
} from '../../../../../test/support/fakes';
import { markUploaded, newDocumentAwaitingUpload } from '../../domain/entities/document.entity';
import { DocumentId } from '../../domain/value-objects/document-id.vo';
import { type DocumentSize } from '../../domain/value-objects/document-size.vo';
import { DocumentStatus, ExtractionMethod } from '../../domain/value-objects/document-status.vo';
import { type DocumentTitle } from '../../domain/value-objects/document-title.vo';
import { OwnerId } from '../../domain/value-objects/owner-id.vo';

import {
  RescheduleStalledOcrUseCase,
  STALLED_OCR_AFTER_MS,
} from './reschedule-stalled-ocr.use-case';

const NOW = new Date('2026-10-12T10:00:00Z');
const OLD = new Date(NOW.getTime() - STALLED_OCR_AFTER_MS - 1000);
const RECENT = new Date(NOW.getTime() - 60_000);

describe('RescheduleStalledOcrUseCase', () => {
  let repo: InMemoryDocumentRepository;
  let scheduler: FakeExtractionScheduler;
  let useCase: RescheduleStalledOcrUseCase;

  async function ocrDocument(id: string, updatedAt: Date, pageCount = 25) {
    const base = markUploaded(
      newDocumentAwaitingUpload({
        id: DocumentId.of(id),
        ownerId: OwnerId.of('user-1'),
        title: 'Scan' as DocumentTitle,
        sizeBytes: 10 as DocumentSize,
        now: OLD,
      }),
      OLD,
    );
    await repo.insert({
      ...base,
      status: DocumentStatus.EXTRACTING,
      extractionMethod: ExtractionMethod.OCR,
      ocrPageCount: pageCount,
      updatedAt,
    });
    return base.id;
  }

  const pages = (from: number, to: number) =>
    Array.from({ length: to - from + 1 }, (_, i) => ({
      pageNumber: from + i,
      lines: [],
      confidence: null,
    }));

  beforeEach(() => {
    repo = new InMemoryDocumentRepository();
    scheduler = new FakeExtractionScheduler();
    useCase = new RescheduleStalledOcrUseCase(repo, scheduler, new FixedClock(NOW));
  });

  it('resumes a stalled OCR at its first missing page, with a retry key', async () => {
    const id = await ocrDocument('01a11019-f2e7-7014-8369-000000000001', OLD);
    await repo.saveOcrPages(id, pages(1, 10), OLD);

    expect(await useCase.execute()).toBe(1);
    expect(scheduler.ocrBatches).toEqual([
      {
        documentId: id,
        fromPage: 11,
        retryKey: `sweep-${String(Math.floor(NOW.getTime() / 60_000))}`,
      },
    ]);
  });

  it('replays the last batch when every page is recognised but the text was never assembled', async () => {
    const id = await ocrDocument('01a11019-f2e7-7014-8369-000000000002', OLD, 3);
    await repo.saveOcrPages(id, pages(1, 3), OLD);

    await useCase.execute();
    expect(scheduler.ocrBatches[0]).toMatchObject({ documentId: id, fromPage: 3 });
  });

  it('leaves alone an OCR that progressed recently', async () => {
    await ocrDocument('01a11019-f2e7-7014-8369-000000000003', RECENT);

    expect(await useCase.execute()).toBe(0);
    expect(scheduler.ocrBatches).toEqual([]);
  });

  it('counts only the batches the queue accepted', async () => {
    await ocrDocument('01a11019-f2e7-7014-8369-000000000004', OLD);
    scheduler.available = false;

    expect(await useCase.execute()).toBe(0);
  });
});
