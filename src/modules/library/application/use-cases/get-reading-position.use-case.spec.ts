import { InMemoryReadingPositionRepository } from '../../../../../test/support/fakes';
import { AT, OWNER } from '../../../../../test/support/fakes/library-stubs';

import { GetReadingPositionUseCase } from './get-reading-position.use-case';

describe('GetReadingPositionUseCase', () => {
  it("returns where to resume, and the same 404 when never started or someone else's", async () => {
    const positions = new InMemoryReadingPositionRepository();
    await positions.saveIfNewer({
      conversionId: 'c1',
      ownerId: OWNER,
      wordIndex: 42,
      audioMs: 4200,
      recordedAt: AT,
      updatedAt: AT,
    });
    const useCase = new GetReadingPositionUseCase(positions);

    const found = await useCase.execute({ ownerId: OWNER, conversionId: 'c1' });
    expect(found.isOk() && found.value.wordIndex).toBe(42);
    for (const input of [
      { ownerId: OWNER, conversionId: 'c2' },
      { ownerId: 'bob', conversionId: 'c1' },
    ]) {
      const missing = await useCase.execute(input);
      expect(missing.isErr() && missing.error.code).toBe('READING_POSITION_NOT_FOUND');
    }
  });
});
