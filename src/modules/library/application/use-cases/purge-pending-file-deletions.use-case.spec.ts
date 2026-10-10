import {
  FakeObjectStorage,
  FixedClock,
  InMemoryFileDeletionOutbox,
} from '../../../../../test/support/fakes';

import { PurgePendingFileDeletionsUseCase } from './purge-pending-file-deletions.use-case';

const AT = new Date('2026-10-10T10:00:00Z');

describe('PurgePendingFileDeletionsUseCase', () => {
  let outbox: InMemoryFileDeletionOutbox;
  let storage: FakeObjectStorage;
  let useCase: PurgePendingFileDeletionsUseCase;

  beforeEach(async () => {
    outbox = new InMemoryFileDeletionOutbox();
    storage = new FakeObjectStorage();
    storage.seed('a.mp3', 'audio');
    // `b.vtt` n'existe pas : l'effacer doit quand même réussir (idempotent).
    await outbox.add(['a.mp3', 'b.vtt'], AT, undefined);
    useCase = new PurgePendingFileDeletionsUseCase(outbox, storage, new FixedClock(AT));
  });

  it('deletes each file then its outbox row, missing files included', async () => {
    expect(await useCase.execute()).toEqual({ deleted: 2, failed: 0 });
    expect(storage.objects.has('a.mp3')).toBe(false);
    expect(outbox.rows.size).toBe(0);
  });

  it('keeps the rows when the storage is down, with the attempt traced', async () => {
    storage.failing = true;
    expect(await useCase.execute()).toEqual({ deleted: 0, failed: 2 });
    expect(outbox.rows.get('a.mp3')).toMatchObject({
      attempts: 1,
      lastError: 'StorageUnavailableError',
    });

    storage.failing = false;
    expect(await useCase.execute()).toEqual({ deleted: 2, failed: 0 });
    expect(storage.objects.has('a.mp3')).toBe(false);
  });
});
