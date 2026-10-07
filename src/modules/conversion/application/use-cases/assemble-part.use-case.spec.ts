import { createHash } from 'node:crypto';

import { CONVERSION_ID, pipeline } from '../../../../../test/support/conversion-pipeline';
import { ConversionStatus } from '../../domain/value-objects/conversion-status.vo';

/** Livre préparé puis entièrement synthétisé (assemblages programmés, pas encore exécutés). */
async function synthesized(pageCount = 12) {
  const p = await pipeline(pageCount);
  await p.prepare.execute(CONVERSION_ID);
  for (const index of await p.repo.listPendingSegmentIndexes(CONVERSION_ID)) {
    await p.synthesize.execute(CONVERSION_ID, index);
  }
  return p;
}

const text = (bytes: Uint8Array | undefined) => new TextDecoder().decode(bytes);

describe('AssemblePartUseCase', () => {
  it('builds each part as MP3 + word-level WebVTT, then writes the manifest and marks the conversion ready', async () => {
    const { assemble, repo, storage, jobs } = await synthesized();
    const parts = await repo.listParts(CONVERSION_ID);
    expect(parts.length).toBeGreaterThan(1);
    expect(jobs.assemblies.map((a) => a.partIndex)).toEqual(parts.map((p) => p.index));

    for (const part of parts) {
      const outcome = await assemble.execute(CONVERSION_ID, part.index);
      expect(outcome).toMatchObject({
        kind: 'assembled',
        conversionReady: part.index === parts.length - 1,
      });
    }
    expect(repo.rows.get(CONVERSION_ID)).toMatchObject({ status: ConversionStatus.READY });
    expect(repo.rows.get(CONVERSION_ID)?.completedAt).not.toBeNull();

    const [first] = await repo.listParts(CONVERSION_ID);
    const assembled = first.assembled;
    const audio = storage.objects.get(assembled?.audio.key ?? '')?.bytes;
    const vtt = storage.objects.get(assembled?.vtt.key ?? '')?.bytes;
    // L'audio de la partie = ses segments bout à bout (trames de 96 octets = 24 ms).
    expect(((audio?.length ?? 0) / 96) * 24).toBe(assembled?.durationMs);
    expect(assembled?.audio).toMatchObject({
      key: `conversions/alice/${CONVERSION_ID}/part-001.mp3`,
      bytes: audio?.length,
      sha256: createHash('sha256')
        .update(audio ?? new Uint8Array())
        .digest('hex'),
    });
    expect(storage.objects.get(assembled?.vtt.key ?? '')?.contentType).toBe('text/vtt');
    // Premier repère : mot 0, à 0 ms ; le moteur factice place un mot toutes les 350 ms.
    expect(text(vtt)).toMatch(/^WEBVTT\n\n0\n00:00:00\.000 --> 00:00:00\.350\nPhrase\n/u);
    expect(assembled?.pageStarts.at(0)).toEqual({ page: 1, wordIndex: 0 });

    const manifest = JSON.parse(
      text(storage.objects.get(`conversions/alice/${CONVERSION_ID}/manifest.json`)?.bytes),
    ) as { complete: boolean; partCount: number };
    expect(manifest).toMatchObject({ complete: true, partCount: parts.length });
  });

  it('continues word indexes and timings across segments: the second part starts at its first word', async () => {
    const { assemble, repo, storage } = await synthesized();
    const parts = await repo.listParts(CONVERSION_ID);
    await assemble.execute(CONVERSION_ID, 1);
    const second = await repo.findPart(CONVERSION_ID, 1);
    const vtt = text(storage.objects.get(second?.assembled?.vtt.key ?? '')?.bytes);
    expect(vtt.split('\n')[2]).toBe(String(parts[1].firstWordIndex));
    expect(vtt.split('\n')[3]).toMatch(/^00:00:00\.000 --> /u);
    // Les pages déjà commencées dans la partie précédente ne « recommencent » pas.
    expect(second?.assembled?.pageStarts.every((s) => s.wordIndex >= parts[1].firstWordIndex)).toBe(
      true,
    );
  });

  it('is idempotent: re-running an assembled part rewrites nothing and still finalizes', async () => {
    const { assemble, repo } = await synthesized(2);
    const parts = await repo.listParts(CONVERSION_ID);
    for (const part of parts) await assemble.execute(CONVERSION_ID, part.index);
    const before = await repo.listParts(CONVERSION_ID);
    // Relance après crash entre l'écriture de la partie et le passage en `ready`.
    const row = repo.rows.get(CONVERSION_ID);
    if (row !== undefined)
      repo.rows.set(CONVERSION_ID, { ...row, status: ConversionStatus.SYNTHESIZED });
    const again = await assemble.execute(CONVERSION_ID, 0);
    expect(again).toMatchObject({ kind: 'assembled', conversionReady: true });
    expect(await repo.listParts(CONVERSION_ID)).toEqual(before);
  });

  it('assembles an early part while the synthesis is still running (preview, RF-15)', async () => {
    const p = await pipeline(12);
    await p.prepare.execute(CONVERSION_ID);
    const [first] = await p.repo.listParts(CONVERSION_ID);
    for (let i = first.firstSegment; i <= first.lastSegment; i += 1) {
      await p.synthesize.execute(CONVERSION_ID, i);
    }
    expect(p.jobs.assemblies).toEqual([{ id: CONVERSION_ID, partIndex: 0 }]);
    expect(await p.assemble.execute(CONVERSION_ID, 0)).toMatchObject({
      kind: 'assembled',
      conversionReady: false,
    });
    expect(p.repo.rows.get(CONVERSION_ID)?.status).toBe(ConversionStatus.SYNTHESIZING);
  });

  it('skips a part with pending segments, an unknown part, and a failed conversion', async () => {
    const p = await pipeline(12);
    await p.prepare.execute(CONVERSION_ID);
    expect(await p.assemble.execute(CONVERSION_ID, 0)).toEqual({
      kind: 'skipped',
      reason: 'segments_pending',
    });
    expect(await p.assemble.execute(CONVERSION_ID, 99)).toEqual({
      kind: 'skipped',
      reason: 'unknown_part',
    });
    const row = p.repo.rows.get(CONVERSION_ID);
    if (row !== undefined)
      p.repo.rows.set(CONVERSION_ID, { ...row, status: ConversionStatus.FAILED });
    expect(await p.assemble.execute(CONVERSION_ID, 0)).toEqual({
      kind: 'skipped',
      reason: 'conversion_not_assemblable',
    });
  });

  it('fails loudly (retry) when a segment audio vanished from storage', async () => {
    const { assemble, storage } = await synthesized(2);
    storage.objects.clear();
    await expect(assemble.execute(CONVERSION_ID, 0)).rejects.toThrow(/Missing segment audio/u);
  });
});
