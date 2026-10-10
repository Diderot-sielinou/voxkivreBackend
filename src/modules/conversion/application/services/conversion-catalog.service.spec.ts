import { InMemoryConversionRepository } from '../../../../../test/support/fakes';
import { newQueuedConversion, type Conversion } from '../../domain/entities/conversion.entity';
import { ConversionId } from '../../domain/value-objects/conversion-id.vo';
import { ConversionStatus } from '../../domain/value-objects/conversion-status.vo';
import { type VoiceId } from '../../domain/voices';

import { ConversionCatalog } from './conversion-catalog.service';

const AT = new Date('2026-10-10T10:00:00Z');

function conversion(
  id: string,
  documentId: string,
  minutes: number,
  overrides: Partial<Conversion> = {},
): Conversion {
  return {
    ...newQueuedConversion({
      id: ConversionId.of(id),
      ownerId: 'alice',
      documentId,
      voiceId: 'fr-f1' as VoiceId,
      textRevision: minutes,
      reservedChars: 100,
      now: new Date(AT.getTime() + minutes * 60_000),
    }),
    ...overrides,
  };
}

const assembled = (wordCount: number) => ({
  audio: { key: 'a', bytes: 1, sha256: 'x' },
  vtt: { key: 'v', bytes: 1, sha256: 'y' },
  durationMs: 1000,
  wordCount,
  pageStarts: [],
});

describe('ConversionCatalog', () => {
  let repo: InMemoryConversionRepository;
  let catalog: ConversionCatalog;

  beforeEach(async () => {
    repo = new InMemoryConversionRepository();
    catalog = new ConversionCatalog(repo);
    await repo.insert(
      conversion('ready', 'd1', 0, { status: ConversionStatus.READY, partCount: 1 }),
    );
    await repo.insert(conversion('retry', 'd1', 5, { status: ConversionStatus.FAILED }));
    await repo.insert(
      conversion('running', 'd2', 0, { status: ConversionStatus.SYNTHESIZING, partCount: 2 }),
    );
    repo.parts.set('ready', [
      {
        conversionId: ConversionId.of('ready'),
        index: 0,
        firstSegment: 0,
        lastSegment: 0,
        firstWordIndex: 0,
        assembled: assembled(120),
      },
    ]);
  });

  it('gives the retained conversion of each document with what is playable', async () => {
    const overviews = await catalog.overviewsByDocument('alice', ['d1', 'd2', 'd3']);
    expect(overviews.get('d1')).toMatchObject({
      conversionId: 'ready',
      partsReady: 1,
      playableWordCount: 120,
      playableDurationMs: 1000,
    });
    expect(overviews.get('d2')).toMatchObject({ conversionId: 'running', partsReady: 0 });
    expect(overviews.has('d3')).toBe(false);
    const foreign = await catalog.overviewsByDocument('bob', ['d1']);
    expect(foreign.size).toBe(0);
  });

  it('reads one conversion for its owner only', async () => {
    const mine = await catalog.overviewForOwner('ready', 'alice');
    expect(mine?.playableWordCount).toBe(120);
    expect(await catalog.overviewForOwner('ready', 'bob')).toBeNull();
  });

  it('reports a running conversion and every file key before a deletion', async () => {
    expect(await catalog.cleanupForDocument('d1')).toEqual({
      running: false,
      fileKeys: [
        'conversions/alice/ready/manifest.json',
        'conversions/alice/ready/part-001.mp3',
        'conversions/alice/ready/part-001.vtt',
        'conversions/alice/retry/manifest.json',
      ],
    });
    const running = await catalog.cleanupForDocument('d2');
    expect(running.running).toBe(true);
  });
});
