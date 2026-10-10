import { Logger } from '@nestjs/common';

import { type PurgeOtpDispatchesUseCase } from '../../application/use-cases/purge-otp-dispatches.use-case';

import { PurgeOtpDispatchesJob } from './purge-otp-dispatches.job';

describe('PurgeOtpDispatchesJob', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('logs the purge and never lets an error escape the cron', async () => {
    const levels: string[] = [];
    for (const level of ['log', 'error'] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation(() => {
        levels.push(level);
      });
    }
    const job = (execute: () => Promise<number>) =>
      new PurgeOtpDispatchesJob({ execute } as unknown as PurgeOtpDispatchesUseCase);

    await job(() => Promise.resolve(3)).run();
    await expect(job(() => Promise.reject(new Error('db down'))).run()).resolves.toBeUndefined();
    expect(levels).toEqual(['log', 'error']);
  });
});
