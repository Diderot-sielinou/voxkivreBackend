import {
  FakeExtractionScheduler,
  FixedClock,
  InMemoryDocumentRepository,
} from '../../../../../test/support/fakes';
import { markUploaded, newDocumentAwaitingUpload } from '../../domain/entities/document.entity';
import { DocumentId } from '../../domain/value-objects/document-id.vo';
import { type DocumentSize } from '../../domain/value-objects/document-size.vo';
import { DocumentStatus } from '../../domain/value-objects/document-status.vo';
import { type DocumentTitle } from '../../domain/value-objects/document-title.vo';
import { OwnerId } from '../../domain/value-objects/owner-id.vo';

import {
  RescheduleStalledExtractionsUseCase,
  STALLED_UPLOAD_AFTER_MS,
} from './reschedule-stalled-extractions.use-case';

const NOW = new Date('2026-10-06T10:00:00Z');

function uploaded(id: string, ageMs: number, status: DocumentStatus = DocumentStatus.UPLOADED) {
  const at = new Date(NOW.getTime() - ageMs);
  const doc = markUploaded(
    newDocumentAwaitingUpload({
      id: DocumentId.of(id),
      ownerId: OwnerId.of('user-1'),
      title: 'x' as DocumentTitle,
      sizeBytes: 1 as DocumentSize,
      now: at,
    }),
    at,
  );
  return { ...doc, status };
}

describe('RescheduleStalledExtractionsUseCase', () => {
  it('reschedules only documents stuck in uploaded for longer than the grace period', async () => {
    const repo = new InMemoryDocumentRepository();
    const scheduler = new FakeExtractionScheduler();
    await repo.insert(uploaded('stalled', STALLED_UPLOAD_AFTER_MS + 1));
    await repo.insert(uploaded('fresh', STALLED_UPLOAD_AFTER_MS - 1));
    await repo.insert(uploaded('running', 10 * STALLED_UPLOAD_AFTER_MS, DocumentStatus.EXTRACTING));

    const useCase = new RescheduleStalledExtractionsUseCase(repo, scheduler, new FixedClock(NOW));
    expect(await useCase.execute()).toBe(1);
    expect(scheduler.scheduled).toEqual(['stalled']);
  });

  it('counts nothing while the queue is still down', async () => {
    const repo = new InMemoryDocumentRepository();
    const scheduler = new FakeExtractionScheduler();
    scheduler.available = false;
    await repo.insert(uploaded('stalled', STALLED_UPLOAD_AFTER_MS + 1));
    const useCase = new RescheduleStalledExtractionsUseCase(repo, scheduler, new FixedClock(NOW));
    expect(await useCase.execute()).toBe(0);
  });
});
