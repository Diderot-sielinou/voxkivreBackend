import { FixedClock } from '../../../../../test/support/fakes';
import { type OtpDispatchLogPort } from '../../domain/ports/otp-dispatch-log.port';

import { PurgeOtpDispatchesUseCase } from './purge-otp-dispatches.use-case';

describe('PurgeOtpDispatchesUseCase', () => {
  it('purges records older than two days', async () => {
    let cutoff: Date | null = null;
    const log = {
      purgeBefore: (before: Date) => {
        cutoff = before;
        return Promise.resolve(7);
      },
    } as unknown as OtpDispatchLogPort;
    const useCase = new PurgeOtpDispatchesUseCase(
      log,
      new FixedClock(new Date('2026-10-10T03:30:00Z')),
    );
    expect(await useCase.execute()).toBe(7);
    expect(cutoff).toEqual(new Date('2026-10-08T03:30:00Z'));
  });
});
