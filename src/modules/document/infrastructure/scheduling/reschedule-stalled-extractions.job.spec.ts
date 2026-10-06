import { Logger } from '@nestjs/common';

import { type RescheduleStalledExtractionsUseCase } from '../../application/use-cases/reschedule-stalled-extractions.use-case';

import { RescheduleStalledExtractionsJob } from './reschedule-stalled-extractions.job';

function jobWith(execute: RescheduleStalledExtractionsUseCase['execute']) {
  return new RescheduleStalledExtractionsJob({ execute } as RescheduleStalledExtractionsUseCase);
}

describe('RescheduleStalledExtractionsJob', () => {
  let warn: jest.SpyInstance;
  let error: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('stays quiet when nothing was stalled, warns otherwise', async () => {
    await jobWith(() => Promise.resolve(0)).run();
    expect(warn).not.toHaveBeenCalled();
    await jobWith(() => Promise.resolve(2)).run();
    expect(warn).toHaveBeenCalledWith({ scheduled: 2 }, expect.any(String));
  });

  it('never throws and logs the failure', async () => {
    await expect(
      jobWith(() => Promise.reject(new Error('db down'))).run(),
    ).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledTimes(1);
  });
});
