import { type ConversionPart } from '../entities/conversion-part.entity';
import { newQueuedConversion, type Conversion } from '../entities/conversion.entity';
import { ConversionId } from '../value-objects/conversion-id.vo';
import { ConversionStatus } from '../value-objects/conversion-status.vo';
import { type VoiceId } from '../voices';

import {
  conversionFileKeys,
  isConversionRunning,
  playableExtent,
  selectLibraryConversion,
} from './conversion-overview';

const AT = new Date('2026-10-10T10:00:00Z');

function conversion(id: string, minutes: number, overrides: Partial<Conversion> = {}): Conversion {
  return {
    ...newQueuedConversion({
      id: ConversionId.of(id),
      ownerId: 'alice',
      documentId: 'doc',
      voiceId: 'fr-f1' as VoiceId,
      textRevision: 1,
      reservedChars: 100,
      now: new Date(AT.getTime() + minutes * 60_000),
    }),
    ...overrides,
  };
}

function part(index: number, firstWordIndex: number, wordCount: number | null): ConversionPart {
  return {
    conversionId: ConversionId.of('c'),
    index,
    firstSegment: index,
    lastSegment: index,
    firstWordIndex,
    assembled:
      wordCount === null
        ? null
        : {
            audio: { key: 'a', bytes: 1, sha256: 'x' },
            vtt: { key: 'v', bytes: 1, sha256: 'y' },
            durationMs: 60_000,
            wordCount,
            pageStarts: [],
          },
  };
}

describe('selectLibraryConversion', () => {
  it('prefers the newest non-failed conversion over a newer failed retry', () => {
    const ready = conversion('ready', 0, { status: ConversionStatus.READY });
    const failedRetry = conversion('failed', 5, { status: ConversionStatus.FAILED });
    expect(selectLibraryConversion([failedRetry, ready])?.id).toBe('ready');
  });

  it('falls back to the newest failed one, and to null without conversions', () => {
    const older = conversion('old', 0, { status: ConversionStatus.FAILED });
    const newer = conversion('new', 5, { status: ConversionStatus.FAILED });
    expect(selectLibraryConversion([older, newer])?.id).toBe('new');
    expect(selectLibraryConversion([])).toBeNull();
  });
});

describe('playableExtent', () => {
  it('counts only the continuous prefix of assembled parts as playable', () => {
    // Parties 0 et 2 prêtes, 1 non : seule la 0 s'écoute.
    const extent = playableExtent([part(2, 200, 100), part(0, 0, 100), part(1, 100, null)]);
    expect(extent).toEqual({ partsReady: 2, wordCount: 100, durationMs: 60_000 });
  });

  it('covers the whole book once every part is assembled, and nothing without parts', () => {
    expect(playableExtent([part(0, 0, 100), part(1, 100, 50)])).toEqual({
      partsReady: 2,
      wordCount: 150,
      durationMs: 120_000,
    });
    expect(playableExtent([])).toEqual({ partsReady: 0, wordCount: 0, durationMs: 0 });
  });
});

describe('conversionFileKeys', () => {
  it('lists the manifest and both files of every planned part', () => {
    const keys = conversionFileKeys(conversion('c1', 0, { partCount: 2 }));
    expect(keys).toEqual([
      'conversions/alice/c1/manifest.json',
      'conversions/alice/c1/part-001.mp3',
      'conversions/alice/c1/part-001.vtt',
      'conversions/alice/c1/part-002.mp3',
      'conversions/alice/c1/part-002.vtt',
    ]);
  });

  it('lists only the manifest before the parts are planned', () => {
    expect(conversionFileKeys(conversion('c1', 0))).toEqual(['conversions/alice/c1/manifest.json']);
  });
});

describe('isConversionRunning', () => {
  it.each([
    [ConversionStatus.QUEUED, true],
    [ConversionStatus.PREPARING, true],
    [ConversionStatus.SYNTHESIZING, true],
    [ConversionStatus.SYNTHESIZED, true],
    [ConversionStatus.READY, false],
    [ConversionStatus.FAILED, false],
  ])('%s → %s', (status, running) => {
    expect(isConversionRunning(conversion('c', 0, { status }))).toBe(running);
  });
});
