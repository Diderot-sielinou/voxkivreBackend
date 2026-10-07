import { buildPartTimeline } from './part-timeline';

const words = (...texts: string[]) => texts.map((t) => ({ t, p: 1 }));

describe('buildPartTimeline', () => {
  it('offsets each segment by the duration of the previous ones; a word ends where the next starts', () => {
    const timeline = buildPartTimeline([
      { firstWordIndex: 0, words: words('Le', 'droit.'), timepoints: [0.1, 0.5], durationMs: 1000 },
      {
        firstWordIndex: 2,
        words: words('Les', 'sociétés.'),
        timepoints: [0.05, 0.4],
        durationMs: 800,
      },
    ]);
    expect(timeline).toEqual([
      { index: 0, text: 'Le', page: 1, startMs: 100, endMs: 500 },
      { index: 1, text: 'droit.', page: 1, startMs: 500, endMs: 1000 },
      { index: 2, text: 'Les', page: 1, startMs: 1050, endMs: 1400 },
      { index: 3, text: 'sociétés.', page: 1, startMs: 1400, endMs: 1800 },
    ]);
  });

  it('interpolates missing marks between known neighbours and never goes backwards', () => {
    const [a, b, c, d] = buildPartTimeline([
      {
        firstWordIndex: 10,
        words: words('a', 'b', 'c', 'd'),
        timepoints: [0, null, null, 0.9],
        durationMs: 1200,
      },
    ]);
    expect([a.startMs, b.startMs, c.startMs, d.startMs]).toEqual([0, 300, 600, 900]);
    const backwards = buildPartTimeline([
      { firstWordIndex: 0, words: words('x', 'y'), timepoints: [0.5, 0.2], durationMs: 1000 },
    ]);
    expect(backwards.map((w) => w.startMs)).toEqual([500, 500]);
  });

  it('interpolates towards the segment end when trailing marks are missing, and clamps to it', () => {
    const timeline = buildPartTimeline([
      { firstWordIndex: 0, words: words('a', 'b'), timepoints: [null, null], durationMs: 900 },
      { firstWordIndex: 2, words: words('c'), timepoints: [5], durationMs: 400 },
    ]);
    expect(timeline.map((w) => [w.startMs, w.endMs])).toEqual([
      [300, 600],
      [600, 900],
      [1300, 1300],
    ]);
  });
});
