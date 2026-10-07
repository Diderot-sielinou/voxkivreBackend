import { CONVERSION_ID, NOW, pipeline } from '../../../../../test/support/conversion-pipeline';

import {
  DOWNLOAD_URL_TTL_SECONDS,
  GetConversionManifestUseCase,
} from './get-conversion-manifest.use-case';

describe('GetConversionManifestUseCase', () => {
  it('409 before any part, then the manifest with signed URLs from the first part on', async () => {
    const p = await pipeline(12);
    const sut = new GetConversionManifestUseCase(p.repo, p.storage, p.clock);
    await p.prepare.execute(CONVERSION_ID);
    const early = await sut.execute({ ownerId: 'alice', conversionId: CONVERSION_ID });
    expect(early.error).toMatchObject({
      code: 'CONVERSION_NOT_READY',
      details: { status: 'synthesizing' },
    });

    const [first] = await p.repo.listParts(CONVERSION_ID);
    for (let i = first.firstSegment; i <= first.lastSegment; i += 1) {
      await p.synthesize.execute(CONVERSION_ID, i);
    }
    await p.assemble.execute(CONVERSION_ID, 0);
    const result = await sut.execute({ ownerId: 'alice', conversionId: CONVERSION_ID });
    const { manifest, urls, urlsExpireAt } = result.value;
    expect(manifest.complete).toBe(false);
    expect(manifest.parts[0].status).toBe('ready');
    expect(manifest.parts[1].status).toBe('pending');
    expect([...urls.keys()]).toEqual(['part-001.mp3', 'part-001.vtt']);
    expect(urls.get('part-001.mp3')).toContain(`expires=${String(DOWNLOAD_URL_TTL_SECONDS)}`);
    expect(urlsExpireAt).toEqual(new Date(NOW.getTime() + DOWNLOAD_URL_TTL_SECONDS * 1000));
  });

  it('404 for another user (RNF-08)', async () => {
    const p = await pipeline(1);
    const result = await new GetConversionManifestUseCase(p.repo, p.storage, p.clock).execute({
      ownerId: 'bob',
      conversionId: CONVERSION_ID,
    });
    expect(result.error.code).toBe('CONVERSION_NOT_FOUND');
  });
});
