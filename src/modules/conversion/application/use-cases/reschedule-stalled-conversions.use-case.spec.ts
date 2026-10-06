import { CONVERSION_ID, NOW, pipeline } from '../../../../../test/support/conversion-pipeline';

import {
  RescheduleStalledConversionsUseCase,
  STALLED_QUEUED_AFTER_MS,
  STALLED_SYNTHESIS_AFTER_MS,
} from './reschedule-stalled-conversions.use-case';

describe('RescheduleStalledConversionsUseCase', () => {
  it('re-schedules a conversion left queued, only once it is old enough', async () => {
    const { repo, jobs, clock } = await pipeline();
    const sut = new RescheduleStalledConversionsUseCase(repo, jobs, clock);
    expect(await sut.execute()).toBe(0);
    clock.advance(STALLED_QUEUED_AFTER_MS + 1);
    expect(await sut.execute()).toBe(1);
    expect(jobs.preparations).toEqual([CONVERSION_ID]);
  });

  it('re-schedules the pending segments of an inactive synthesis', async () => {
    const { repo, jobs, clock, prepare } = await pipeline(2);
    await prepare.execute(CONVERSION_ID);
    jobs.syntheses.length = 0;
    const sut = new RescheduleStalledConversionsUseCase(repo, jobs, clock);
    clock.advance(STALLED_SYNTHESIS_AFTER_MS + 1);
    expect(await sut.execute()).toBe(1);
    expect(jobs.syntheses).toHaveLength(1);
    expect(NOW).toBeInstanceOf(Date);
  });

  it('skips a synthesizing conversion with nothing left to do', async () => {
    const { repo, jobs, clock, prepare } = await pipeline(1);
    await prepare.execute(CONVERSION_ID);
    for (const index of await repo.listPendingSegmentIndexes(CONVERSION_ID)) {
      await repo.completeSegment(
        CONVERSION_ID,
        index,
        { audioKey: 'k', timepoints: [], durationMs: 1, cacheHit: false },
        NOW,
      );
    }
    clock.advance(STALLED_SYNTHESIS_AFTER_MS + 1);
    jobs.syntheses.length = 0;
    expect(await new RescheduleStalledConversionsUseCase(repo, jobs, clock).execute()).toBe(0);
  });
});
