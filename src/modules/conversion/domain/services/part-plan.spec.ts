import { FIRST_PART_TARGET_CHARS, PART_TARGET_CHARS, planParts } from './part-plan';

const segments = (counts: number[]) => counts.map((charCount) => ({ charCount }));

describe('planParts', () => {
  it('makes a short first part (preview), then ~10-minute parts, on segment boundaries', () => {
    const parts = planParts(segments(Array.from({ length: 30 }, () => 1000)));
    expect(parts[0]).toEqual({ index: 0, firstSegment: 0, lastSegment: 1 }); // 2 000 ≥ 1 800
    expect(parts[1]).toEqual({ index: 1, firstSegment: 2, lastSegment: 10 }); // 9 000
    expect(parts.at(-1)?.lastSegment).toBe(29);
    // Couverture exacte, sans trou ni recouvrement.
    for (let i = 1; i < parts.length; i += 1) {
      expect(parts[i].firstSegment).toBe(parts[i - 1].lastSegment + 1);
    }
    expect(FIRST_PART_TARGET_CHARS).toBeLessThan(PART_TARGET_CHARS);
  });

  it('keeps a short remainder as the last part, and handles tiny or empty books', () => {
    expect(planParts(segments([500]))).toEqual([{ index: 0, firstSegment: 0, lastSegment: 0 }]);
    expect(planParts(segments([2000, 300]))).toEqual([
      { index: 0, firstSegment: 0, lastSegment: 0 },
      { index: 1, firstSegment: 1, lastSegment: 1 },
    ]);
    expect(planParts([])).toEqual([]);
  });
});
