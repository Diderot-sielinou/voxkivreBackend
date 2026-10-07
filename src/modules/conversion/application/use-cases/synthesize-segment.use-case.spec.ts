import { CONVERSION_ID, pipeline } from '../../../../../test/support/conversion-pipeline';
import { TtsRequestRejectedError, TtsUnavailableError } from '../../domain/errors/tts.errors';
import { ConversionStatus } from '../../domain/value-objects/conversion-status.vo';

import { alignTimepoints } from './synthesize-segment.use-case';

async function prepared(pageCount = 2) {
  const p = await pipeline(pageCount);
  await p.prepare.execute(CONVERSION_ID);
  const count = p.repo.rows.get(CONVERSION_ID)?.segmentCount ?? 0;
  return { ...p, count };
}

describe('SynthesizeSegmentUseCase', () => {
  it('synthesizes each segment once, stores MP3 + marks, and completes the conversion', async () => {
    const { synthesize, repo, storage, tts, count } = await prepared();
    for (let i = 0; i < count; i += 1) {
      const outcome = await synthesize.execute(CONVERSION_ID, i);
      expect(outcome).toEqual({
        kind: 'synthesized',
        cacheHit: false,
        conversionCompleted: i === count - 1,
      });
    }
    expect(tts.calls).toHaveLength(count);
    expect(repo.rows.get(CONVERSION_ID)).toMatchObject({ status: ConversionStatus.SYNTHESIZED });
    const segment = await repo.findSegment(CONVERSION_ID, 0);
    expect(segment?.audio?.audioKey).toMatch(/^tts-cache\/[0-9a-f]{64}\.mp3$/u);
    expect(segment?.audio?.timepoints).toHaveLength(segment?.words.length ?? -1);
    expect(segment?.audio?.timepoints.slice(0, 2)).toEqual([0, 0.35]);
    expect(storage.objects.get(segment?.audio?.audioKey ?? '')?.contentType).toBe('audio/mpeg');
  });

  it('never calls the engine twice for a segment (re-run = nothing to do)', async () => {
    const { synthesize, tts } = await prepared();
    await synthesize.execute(CONVERSION_ID, 0);
    expect(await synthesize.execute(CONVERSION_ID, 0)).toEqual({ kind: 'skipped' });
    expect(tts.calls).toHaveLength(1);
  });

  it('reuses the fingerprint cache across conversions without calling the engine (RNF-26)', async () => {
    const first = await prepared();
    await first.synthesize.execute(CONVERSION_ID, 0);
    // Même texte, autre conversion (autre utilisateur) : mêmes empreintes.
    const second = await prepared();
    for (const [key, value] of first.storage.objects) second.storage.objects.set(key, value);
    expect(await second.synthesize.execute(CONVERSION_ID, 0)).toMatchObject({ cacheHit: true });
    expect(second.tts.calls).toHaveLength(0);
    const reused = await second.repo.findSegment(CONVERSION_ID, 0);
    expect(reused?.audio?.cacheHit).toBe(true);
  });

  it('ignores a corrupt or half-written cache entry and synthesizes again', async () => {
    const { synthesize, storage, tts, repo } = await prepared();
    const segment = await repo.findSegment(CONVERSION_ID, 0);
    const fingerprint = segment?.fingerprint ?? '';
    storage.seed(`tts-cache/${fingerprint}.json`, '{not json', 'application/json');
    await synthesize.execute(CONVERSION_ID, 0);
    expect(tts.calls).toHaveLength(1);

    const other = await prepared();
    other.storage.seed(
      `tts-cache/${fingerprint}.json`,
      JSON.stringify({ durationMs: 1, marks: [] }),
      'application/json',
    ); // .json sans .mp3 : écriture interrompue
    await other.synthesize.execute(CONVERSION_ID, 0);
    expect(other.tts.calls).toHaveLength(1);
  });

  it('closes the conversion on a re-run after a crash between segment write and completion', async () => {
    const { synthesize, repo, count } = await prepared(1);
    for (let i = 0; i < count; i += 1) {
      await repo.completeSegment(
        CONVERSION_ID,
        i,
        { audioKey: 'k', timepoints: [], durationMs: 1, cacheHit: false },
        new Date(),
      );
    }
    expect(await synthesize.execute(CONVERSION_ID, 0)).toEqual({ kind: 'skipped' });
    expect(repo.rows.get(CONVERSION_ID)?.status).toBe(ConversionStatus.SYNTHESIZED);
  });

  it('fails the conversion with a refund when the engine rejects the request', async () => {
    const { synthesize, repo, tts, quota } = await prepared();
    tts.failWith = new TtsRequestRejectedError('bad ssml');
    expect(await synthesize.execute(CONVERSION_ID, 0)).toEqual({ kind: 'rejected' });
    expect(repo.rows.get(CONVERSION_ID)).toMatchObject({
      status: ConversionStatus.FAILED,
      failureReason: 'tts_rejected',
    });
    expect(quota.refunds).toEqual([{ reservationId: CONVERSION_ID, chars: 5000 }]);
  });

  it('treats truncated audio as an outage: nothing cached, the queue retries', async () => {
    const { synthesize, tts, storage } = await prepared();
    const engine = tts.synthesize.bind(tts);
    jest.spyOn(tts, 'synthesize').mockImplementation(async (input) => {
      const full = await engine(input);
      return { ...full, durationMs: 100 }; // dernier mot annoncé bien après la fin
    });
    await expect(synthesize.execute(CONVERSION_ID, 0)).rejects.toBeInstanceOf(TtsUnavailableError);
    expect(storage.objects.size).toBe(0);
  });

  it('re-synthesizes a truncated audio found in the cache', async () => {
    const { synthesize, repo, storage, tts } = await prepared();
    const segment = await repo.findSegment(CONVERSION_ID, 0);
    const fingerprint = segment?.fingerprint ?? '';
    storage.seed(`tts-cache/${fingerprint}.mp3`, 'x', 'audio/mpeg');
    storage.seed(
      `tts-cache/${fingerprint}.json`,
      JSON.stringify({
        durationMs: 10,
        marks: [
          { name: 'w0', timeSeconds: 0 },
          { name: 'w1', timeSeconds: 5 },
        ],
      }),
      'application/json',
    );
    expect(await synthesize.execute(CONVERSION_ID, 0)).toMatchObject({ cacheHit: false });
    expect(tts.calls).toHaveLength(1);
  });

  it('lets an engine outage propagate (the queue retries), without writing anything', async () => {
    const { synthesize, tts, storage } = await prepared();
    tts.failWith = new TtsUnavailableError('503');
    await expect(synthesize.execute(CONVERSION_ID, 0)).rejects.toBeInstanceOf(TtsUnavailableError);
    expect(storage.objects.size).toBe(0);
  });

  it('spends nothing on a failed conversion or an unknown segment', async () => {
    const { synthesize, repo, tts } = await prepared();
    expect(await synthesize.execute(CONVERSION_ID, 999)).toEqual({ kind: 'skipped' });
    const row = repo.rows.get(CONVERSION_ID);
    if (row !== undefined)
      repo.rows.set(CONVERSION_ID, { ...row, status: ConversionStatus.FAILED });
    expect(await synthesize.execute(CONVERSION_ID, 0)).toEqual({ kind: 'skipped' });
    expect(tts.calls).toHaveLength(0);
  });
});

describe('alignTimepoints', () => {
  it('aligns marks on words and leaves null for a missing mark', () => {
    const words = [
      { t: 'a', p: 1 },
      { t: 'b', p: 1 },
      { t: 'c', p: 1 },
    ];
    expect(
      alignTimepoints({ words }, [
        { name: 'w2', timeSeconds: 0.9 },
        { name: 'w0', timeSeconds: 0.1 },
      ]),
    ).toEqual([0.1, null, 0.9]);
  });
});
