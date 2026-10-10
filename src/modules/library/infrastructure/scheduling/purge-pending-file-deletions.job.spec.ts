import { Logger } from '@nestjs/common';

import { type PurgePendingFileDeletionsUseCase } from '../../application/use-cases/purge-pending-file-deletions.use-case';

import { PurgePendingFileDeletionsJob } from './purge-pending-file-deletions.job';

describe('PurgePendingFileDeletionsJob', () => {
  let logs: { level: string; args: unknown[] }[];

  beforeEach(() => {
    logs = [];
    for (const level of ['log', 'warn', 'error'] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
        logs.push({ level, args });
      });
    }
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function jobWith(execute: () => Promise<{ deleted: number; failed: number }>) {
    return new PurgePendingFileDeletionsJob({
      execute,
    } as unknown as PurgePendingFileDeletionsUseCase);
  }

  it('logs deletions and failures, and stays silent when there is nothing to do', async () => {
    await jobWith(() => Promise.resolve({ deleted: 0, failed: 0 })).run();
    expect(logs).toEqual([]);

    await jobWith(() => Promise.resolve({ deleted: 3, failed: 1 })).run();
    expect(logs.map((l) => l.level)).toEqual(['log', 'warn']);
  });

  it('never lets an error escape the cron (it would be swallowed)', async () => {
    await expect(
      jobWith(() => Promise.reject(new Error('db down'))).run(),
    ).resolves.toBeUndefined();
    expect(logs.map((l) => l.level)).toEqual(['error']);
  });
});
