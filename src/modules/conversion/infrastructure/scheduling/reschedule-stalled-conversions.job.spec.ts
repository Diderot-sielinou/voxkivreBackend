import { Logger } from '@nestjs/common';

import { type RescheduleStalledConversionsUseCase } from '../../application/use-cases/reschedule-stalled-conversions.use-case';

import { RescheduleStalledConversionsJob } from './reschedule-stalled-conversions.job';

describe('RescheduleStalledConversionsJob', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('logs what it rescheduled, and never throws', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const ok = {
      execute: () => Promise.resolve(2),
    } as unknown as RescheduleStalledConversionsUseCase;
    await new RescheduleStalledConversionsJob(ok).run();
    expect(warn).toHaveBeenCalledTimes(1);
    const down = {
      execute: () => Promise.reject(new Error('db down')),
    } as unknown as RescheduleStalledConversionsUseCase;
    await expect(new RescheduleStalledConversionsJob(down).run()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledTimes(1);
  });
});
