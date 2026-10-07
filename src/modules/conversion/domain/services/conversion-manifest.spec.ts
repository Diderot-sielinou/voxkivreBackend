import { type ConversionPart } from '../entities/conversion-part.entity';
import { newQueuedConversion } from '../entities/conversion.entity';
import { ConversionId } from '../value-objects/conversion-id.vo';
import { type VoiceId } from '../voices';

import { manifestKey, partFileKeys } from './conversion-files';
import { buildManifest, MANIFEST_VERSION } from './conversion-manifest';

const ID = ConversionId.of('01a11019-f2e7-7014-8369-af25cb7e0f0c');
const conversion = newQueuedConversion({
  id: ID,
  ownerId: 'alice',
  documentId: 'doc',
  voiceId: 'fr-f1' as VoiceId,
  textRevision: 3,
  reservedChars: 10,
  now: new Date('2026-10-07T10:00:00Z'),
});

function part(index: number, durationMs: number | null): ConversionPart {
  const keys = partFileKeys('alice', ID, index);
  return {
    conversionId: ID,
    index,
    firstSegment: index * 10,
    lastSegment: index * 10 + 9,
    firstWordIndex: index * 1000,
    assembled:
      durationMs === null
        ? null
        : {
            audio: { key: keys.audio, bytes: 100, sha256: 'a'.repeat(64) },
            vtt: { key: keys.vtt, bytes: 50, sha256: 'b'.repeat(64) },
            durationMs,
            wordCount: 1000,
            pageStarts: [{ page: index + 1, wordIndex: index * 1000 }],
          },
  };
}

describe('buildManifest', () => {
  it('describes a complete book: absolute starts, total duration, file names only', () => {
    const manifest = buildManifest(conversion, [part(0, 120_000), part(1, 600_000)]);
    expect(manifest).toMatchObject({
      version: MANIFEST_VERSION,
      conversionId: ID,
      documentId: 'doc',
      voiceId: 'fr-f1',
      textRevision: 3,
      complete: true,
      durationMs: 720_000,
      partCount: 2,
    });
    expect(manifest.parts[1]).toEqual({
      index: 1,
      status: 'ready',
      firstWordIndex: 1000,
      durationMs: 600_000,
      startMs: 120_000,
      wordCount: 1000,
      pageStarts: [{ page: 2, wordIndex: 1000 }],
      audio: { name: 'part-002.mp3', bytes: 100, sha256: 'a'.repeat(64) },
      vtt: { name: 'part-002.vtt', bytes: 50, sha256: 'b'.repeat(64) },
    });
  });

  it('lists pending parts and leaves unknown starts empty while the book is in progress', () => {
    const manifest = buildManifest(conversion, [part(0, 120_000), part(1, null), part(2, 600_000)]);
    expect(manifest.complete).toBe(false);
    expect(manifest.durationMs).toBeNull();
    expect(manifest.parts.map((p) => [p.status, p.startMs])).toEqual([
      ['ready', 0],
      ['pending', null],
      ['ready', null],
    ]);
    expect(buildManifest(conversion, []).complete).toBe(false);
  });

  it('keeps every file of a conversion under its owner prefix', () => {
    expect(partFileKeys('a/b', ID, 0)).toEqual({
      audio: `conversions/a%2Fb/${ID}/part-001.mp3`,
      vtt: `conversions/a%2Fb/${ID}/part-001.vtt`,
    });
    expect(manifestKey('alice', ID)).toBe(`conversions/alice/${ID}/manifest.json`);
  });
});
