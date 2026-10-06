import {
  FakeObjectStorage,
  FixedClock,
  InMemoryDocumentRepository,
} from '../../../../../test/support/fakes';
import { type DocumentUploadPolicy } from '../../domain/document-upload-policy';
import { markUploaded, newDocumentAwaitingUpload } from '../../domain/entities/document.entity';
import { DocumentId } from '../../domain/value-objects/document-id.vo';
import { type DocumentSize } from '../../domain/value-objects/document-size.vo';
import { type DocumentTitle } from '../../domain/value-objects/document-title.vo';
import { OwnerId } from '../../domain/value-objects/owner-id.vo';

import { PurgeAbandonedUploadsUseCase } from './purge-abandoned-uploads.use-case';

const DAY_MS = 86_400_000;
const NOW = new Date('2026-10-06T03:00:00Z');
const POLICY: DocumentUploadPolicy = {
  maxSizeBytes: 1000,
  uploadUrlTtlSeconds: 900,
  abandonedUploadTtlSeconds: 86_400,
};

function doc(id: string, ageMs: number) {
  return newDocumentAwaitingUpload({
    id: DocumentId.of(id),
    ownerId: OwnerId.of('user-1'),
    title: 'x' as DocumentTitle,
    sizeBytes: 5 as DocumentSize,
    now: new Date(NOW.getTime() - ageMs),
  });
}

describe('PurgeAbandonedUploadsUseCase', () => {
  let repo: InMemoryDocumentRepository;
  let storage: FakeObjectStorage;
  let useCase: PurgeAbandonedUploadsUseCase;

  beforeEach(() => {
    repo = new InMemoryDocumentRepository();
    storage = new FakeObjectStorage();
    useCase = new PurgeAbandonedUploadsUseCase(repo, storage, new FixedClock(NOW), POLICY);
  });

  it('deletes only awaiting_upload documents older than 24 h, with their file', async () => {
    const stale = doc('stale', DAY_MS + 1);
    const fresh = doc('fresh', DAY_MS - 1);
    const uploaded = markUploaded(doc('uploaded', 3 * DAY_MS), NOW);
    for (const d of [stale, fresh, uploaded]) {
      await repo.insert(d);
      storage.put(d.sourceKey, '%PDF-');
    }

    expect(await useCase.execute()).toEqual({ purged: 1, orphanKeys: [] });
    expect([...repo.rows.keys()].toSorted((a, b) => a.localeCompare(b))).toEqual([
      'fresh',
      'uploaded',
    ]);
    expect(storage.objects.has(stale.sourceKey)).toBe(false);
    expect(storage.objects.has(fresh.sourceKey)).toBe(true);
    expect(storage.objects.has(uploaded.sourceKey)).toBe(true);
  });

  it('keeps the file when a late confirmation won the race (row no longer awaiting_upload)', async () => {
    const stale = doc('stale', 2 * DAY_MS);
    await repo.insert(stale);
    storage.put(stale.sourceKey, '%PDF-');
    // La confirmation passe entre la lecture et la suppression conditionnelle.
    repo.deleteIfAwaitingUpload = () => Promise.resolve(false);

    expect(await useCase.execute()).toEqual({ purged: 0, orphanKeys: [] });
    expect(storage.objects.has(stale.sourceKey)).toBe(true);
  });

  it('keeps purging when storage fails and reports the orphan keys', async () => {
    const a = doc('a', 2 * DAY_MS);
    const b = doc('b', 2 * DAY_MS);
    await repo.insert(a);
    await repo.insert(b);
    storage.failing = true;

    const report = await useCase.execute();
    expect(report.purged).toBe(2);
    expect(report.orphanKeys.toSorted((a, b) => a.localeCompare(b))).toEqual(
      [a.sourceKey, b.sourceKey].toSorted((a, b) => a.localeCompare(b)),
    );
    expect(repo.rows.size).toBe(0);
  });
});
