import { CONVERSION_ID, DOC, pipeline } from '../../../../../test/support/conversion-pipeline';
import { ConversionStatus } from '../../domain/value-objects/conversion-status.vo';

describe('PrepareConversionUseCase', () => {
  it('splits the text into fingerprinted segments, then schedules one synthesis per segment', async () => {
    const { prepare, repo, jobs } = await pipeline(3);
    const outcome = await prepare.execute(CONVERSION_ID);
    expect(outcome).toMatchObject({ kind: 'prepared' });
    const count = outcome.kind === 'prepared' ? outcome.segmentCount : 0;
    expect(count).toBeGreaterThan(1);
    expect(repo.rows.get(CONVERSION_ID)).toMatchObject({
      status: ConversionStatus.SYNTHESIZING,
      segmentCount: count,
    });
    const segment = await repo.findSegment(CONVERSION_ID, 0);
    expect(segment?.fingerprint).toMatch(/^[0-9a-f]{64}$/u);
    // Plan des parties et position des mots (ADR-0011).
    const parts = await repo.listParts(CONVERSION_ID);
    expect(repo.rows.get(CONVERSION_ID)?.partCount).toBe(parts.length);
    expect(parts.at(-1)?.lastSegment).toBe(count - 1);
    const second = await repo.findSegment(CONVERSION_ID, 1);
    expect(second?.firstWordIndex).toBe(segment?.words.length);
    expect(second?.partIndex).toBe(parts.find((p) => p.lastSegment >= 1)?.index);
    expect(jobs.syntheses).toEqual([
      { id: CONVERSION_ID, indexes: Array.from({ length: count }, (_, i) => i) },
    ]);
  });

  it('on a re-run after preparation, only re-schedules segments still without audio', async () => {
    const { prepare, repo, jobs } = await pipeline(3);
    await prepare.execute(CONVERSION_ID);
    await repo.completeSegment(
      CONVERSION_ID,
      0,
      { audioKey: 'k', timepoints: [], durationMs: 1, cacheHit: false },
      new Date(),
    );
    const outcome = await prepare.execute(CONVERSION_ID);
    expect(outcome).toMatchObject({ kind: 'resumed' });
    expect(jobs.syntheses.at(-1)?.indexes.includes(0)).toBe(false);
  });

  it('fails with text_changed and refunds everything when the text was edited after launch', async () => {
    const { prepare, documents, repo, quota } = await pipeline();
    const text = documents.texts.get(DOC);
    if (text !== undefined) documents.texts.set(DOC, { ...text, textRevision: 3 });
    expect(await prepare.execute(CONVERSION_ID)).toEqual({
      kind: 'failed',
      reason: 'text_changed',
    });
    expect(repo.rows.get(CONVERSION_ID)?.status).toBe(ConversionStatus.FAILED);
    expect(quota.refunds).toEqual([{ reservationId: CONVERSION_ID, chars: 5000 }]);
  });

  it('fails with text_changed when a page is corrected while pages are being read', async () => {
    const { prepare, documents } = await pipeline();
    documents.onReadPages = () => {
      const text = documents.texts.get(DOC);
      if (text !== undefined) documents.texts.set(DOC, { ...text, textRevision: 3 });
    };
    expect(await prepare.execute(CONVERSION_ID)).toEqual({
      kind: 'failed',
      reason: 'text_changed',
    });
  });

  it('fails with source_unavailable when the document is gone, and empty_text on blank pages', async () => {
    const gone = await pipeline();
    gone.documents.texts.delete(DOC);
    expect(await gone.prepare.execute(CONVERSION_ID)).toEqual({
      kind: 'failed',
      reason: 'source_unavailable',
    });
    const blank = await pipeline();
    blank.documents.pages.set(DOC, [{ pageNumber: 1, text: '   ' }]);
    expect(await blank.prepare.execute(CONVERSION_ID)).toEqual({
      kind: 'failed',
      reason: 'empty_text',
    });
  });

  it('skips a missing or already finished conversion', async () => {
    const { prepare, repo } = await pipeline();
    repo.rows.delete(CONVERSION_ID);
    expect(await prepare.execute(CONVERSION_ID)).toEqual({ kind: 'skipped' });
    const failed = await pipeline();
    const row = failed.repo.rows.get(CONVERSION_ID);
    if (row !== undefined) {
      failed.repo.rows.set(CONVERSION_ID, { ...row, status: ConversionStatus.FAILED });
    }
    expect(await failed.prepare.execute(CONVERSION_ID)).toEqual({ kind: 'skipped' });
  });
});
