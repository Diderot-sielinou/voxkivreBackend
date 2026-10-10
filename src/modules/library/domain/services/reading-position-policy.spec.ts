import {
  AUDIO_END_TOLERANCE_MS,
  CLOCK_SKEW_TOLERANCE_MS,
  validateReadingPosition,
} from './reading-position-policy';

const NOW = new Date('2026-10-10T10:00:00Z');
const BOUNDS = { playableWordCount: 100, playableDurationMs: 60_000 };

function reasonOf(input: { wordIndex: number; audioMs: number; recordedAt: Date }): unknown {
  const result = validateReadingPosition(input, BOUNDS, NOW);
  return result.isErr() ? result.error.details?.reason : 'ok';
}

describe('validateReadingPosition', () => {
  it('accepts a position inside what is playable, up to the last word', () => {
    expect(reasonOf({ wordIndex: 0, audioMs: 0, recordedAt: NOW })).toBe('ok');
    expect(reasonOf({ wordIndex: 99, audioMs: 60_000, recordedAt: NOW })).toBe('ok');
  });

  it('rejects a word beyond the playable words', () => {
    expect(reasonOf({ wordIndex: 100, audioMs: 0, recordedAt: NOW })).toBe('word_out_of_range');
  });

  it('tolerates a small overshoot of the audio end, not more', () => {
    expect(
      reasonOf({ wordIndex: 1, audioMs: 60_000 + AUDIO_END_TOLERANCE_MS, recordedAt: NOW }),
    ).toBe('ok');
    expect(
      reasonOf({ wordIndex: 1, audioMs: 60_000 + AUDIO_END_TOLERANCE_MS + 1, recordedAt: NOW }),
    ).toBe('audio_out_of_range');
  });

  it('tolerates a device clock slightly ahead, not a position from the future', () => {
    const ahead = (ms: number) => new Date(NOW.getTime() + ms);
    expect(reasonOf({ wordIndex: 1, audioMs: 0, recordedAt: ahead(CLOCK_SKEW_TOLERANCE_MS) })).toBe(
      'ok',
    );
    expect(
      reasonOf({ wordIndex: 1, audioMs: 0, recordedAt: ahead(CLOCK_SKEW_TOLERANCE_MS + 1) }),
    ).toBe('recorded_in_future');
  });
});
