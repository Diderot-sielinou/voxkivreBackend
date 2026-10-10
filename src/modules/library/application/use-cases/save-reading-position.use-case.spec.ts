import { FixedClock, InMemoryReadingPositionRepository } from '../../../../../test/support/fakes';
import {
  AT,
  libraryConversion,
  OWNER,
  StubLibraryConversions,
} from '../../../../../test/support/fakes/library-stubs';
import { ConversionState } from '../../domain/value-objects/library-item-status.vo';

import { SaveReadingPositionUseCase } from './save-reading-position.use-case';

describe('SaveReadingPositionUseCase', () => {
  let conversions: StubLibraryConversions;
  let positions: InMemoryReadingPositionRepository;
  let useCase: SaveReadingPositionUseCase;

  beforeEach(() => {
    conversions = new StubLibraryConversions();
    positions = new InMemoryReadingPositionRepository();
    conversions.add(libraryConversion('c1', 'd1'));
    useCase = new SaveReadingPositionUseCase(conversions, positions, new FixedClock(AT));
  });

  const save = (wordIndex: number, minutesAgo: number, conversionId = 'c1', ownerId = OWNER) =>
    useCase.execute({
      ownerId,
      conversionId,
      wordIndex,
      audioMs: wordIndex * 100,
      recordedAt: new Date(AT.getTime() - minutesAgo * 60_000),
    });

  it('saves a position, and the newest one wins across devices', async () => {
    const phone = await save(500, 1);
    expect(phone.isOk() && phone.value).toMatchObject({
      applied: true,
      position: { wordIndex: 500 },
    });

    // Tablette restée hors-ligne : sa position (plus ancienne) arrive après.
    const tablet = await save(120, 30);
    expect(tablet.isOk() && tablet.value).toMatchObject({
      applied: false,
      position: { wordIndex: 500 },
    });

    const later = await save(510, 0);
    expect(later.isOk() && later.value.position.wordIndex).toBe(510);
  });

  it('replaying the same request changes nothing', async () => {
    await save(500, 1);
    const replay = await save(500, 1);
    expect(replay.isOk() && replay.value.applied).toBe(false);
  });

  it('404 for an unknown or foreign conversion, 409 while nothing is playable', async () => {
    const unknown = await save(1, 0, 'nope');
    expect(unknown.isErr() && unknown.error.code).toBe('CONVERSION_NOT_FOUND');
    const foreign = await save(1, 0, 'c1', 'bob');
    expect(foreign.isErr() && foreign.error.code).toBe('CONVERSION_NOT_FOUND');

    conversions.add(
      libraryConversion('c2', 'd2', {
        status: 'preparing',
        state: ConversionState.PROCESSING,
        playableWordCount: 0,
        playableDurationMs: 0,
      }),
    );
    const notReady = await save(0, 0, 'c2');
    expect(notReady.isErr() && notReady.error.code).toBe('CONVERSION_NOT_READY');
  });

  it('422 for a position outside what is playable', async () => {
    const result = await save(1000, 0);
    expect(result.isErr() && result.error.code).toBe('INVALID_READING_POSITION');
    expect(positions.rows.size).toBe(0);
  });
});
