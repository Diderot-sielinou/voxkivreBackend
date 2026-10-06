import { Logger } from '@nestjs/common';

import { type PurgeAbandonedUploadsUseCase } from '../../application/use-cases/purge-abandoned-uploads.use-case';

import { PurgeAbandonedUploadsJob } from './purge-abandoned-uploads.job';

function jobWith(execute: PurgeAbandonedUploadsUseCase['execute']) {
  return new PurgeAbandonedUploadsJob({ execute } as PurgeAbandonedUploadsUseCase);
}

describe('PurgeAbandonedUploadsJob', () => {
  let log: jest.SpyInstance;
  let error: jest.SpyInstance;

  beforeEach(() => {
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('logs the purge count', async () => {
    await jobWith(() => Promise.resolve({ purged: 3, orphanKeys: [] })).run();
    expect(log).toHaveBeenCalledWith({ purged: 3 }, expect.any(String));
    expect(error).not.toHaveBeenCalled();
  });

  it('logs orphan files as an error', async () => {
    await jobWith(() =>
      Promise.resolve({ purged: 1, orphanKeys: ['documents/u/d/source.pdf'] }),
    ).run();
    expect(error).toHaveBeenCalledWith(
      { orphanKeys: ['documents/u/d/source.pdf'] },
      expect.any(String),
    );
  });

  it('never throws (the scheduler would swallow it) and logs the failure', async () => {
    const boom = new Error('db down');
    await expect(jobWith(() => Promise.reject(boom)).run()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith({ err: boom }, expect.any(String));
  });
});
