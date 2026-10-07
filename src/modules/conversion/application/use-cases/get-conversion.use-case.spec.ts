import { CONVERSION_ID, pipeline } from '../../../../../test/support/conversion-pipeline';

import { GetConversionUseCase } from './get-conversion.use-case';
import { ListVoicesUseCase } from './list-voices.use-case';

describe('GetConversionUseCase', () => {
  it('returns the progress for the owner, and a 404 for anyone else (RNF-08)', async () => {
    const { prepare, synthesize, repo } = await pipeline(2);
    const sut = new GetConversionUseCase(repo);
    const queued = await sut.execute({ ownerId: 'alice', conversionId: CONVERSION_ID });
    expect(queued.value).toMatchObject({ segmentsDone: 0 });
    await prepare.execute(CONVERSION_ID);
    await synthesize.execute(CONVERSION_ID, 0);
    const progress = await sut.execute({ ownerId: 'alice', conversionId: CONVERSION_ID });
    expect(progress.value).toMatchObject({ segmentsDone: 1, partsReady: 0 });
    const other = await sut.execute({ ownerId: 'bob', conversionId: CONVERSION_ID });
    expect(other.error.code).toBe('CONVERSION_NOT_FOUND');
  });
});

describe('ListVoicesUseCase', () => {
  it('lists the whitelisted voices with exactly one default', () => {
    const voices = new ListVoicesUseCase().execute();
    expect(voices.map((v) => v.id)).toEqual(['fr-f1', 'fr-m1', 'fr-f2', 'fr-m2']);
    expect(voices.filter((v) => v.isDefault).map((v) => v.id)).toEqual(['fr-f1']);
  });
});
