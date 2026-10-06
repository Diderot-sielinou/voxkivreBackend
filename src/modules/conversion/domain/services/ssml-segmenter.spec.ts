import {
  buildSsmlSegments,
  MAX_SSML_BYTES,
  MAX_WORD_LENGTH,
  type PageText,
  ssmlByteLength,
} from './ssml-segmenter';

/** Texte réaliste : phrases de longueur variable, accents. */
function sentence(i: number): string {
  const words = ['élève', 'cours', 'droit', 'économie', 'société', 'été', 'règle', 'générale'];
  const length = 8 + (i % 13);
  return `${Array.from({ length }, (_, k) => words[(i + k) % words.length]).join(' ')} ${String(i)}.`;
}

function book(sentences: number, perPage = 12): PageText[] {
  const pages: PageText[] = [];
  for (let start = 0; start < sentences; start += perPage) {
    const text = Array.from({ length: Math.min(perPage, sentences - start) }, (_, k) =>
      sentence(start + k),
    ).join('\n');
    pages.push({ pageNumber: pages.length + 1, text });
  }
  return pages;
}

describe('buildSsmlSegments', () => {
  it('puts one locally numbered mark before every word, and escapes XML', () => {
    const [segment] = buildSsmlSegments([{ pageNumber: 1, text: 'Tom & "Léa" <ont> lu.' }]);
    expect(segment.ssml).toBe(
      '<speak><mark name="w0"/>Tom <mark name="w1"/>&amp; <mark name="w2"/>&quot;Léa&quot; ' +
        '<mark name="w3"/>&lt;ont&gt; <mark name="w4"/>lu.</speak>',
    );
    expect(segment.words).toEqual([
      { t: 'Tom', p: 1 },
      { t: '&', p: 1 },
      { t: '"Léa"', p: 1 },
      { t: '<ont>', p: 1 },
      { t: 'lu.', p: 1 },
    ]);
    expect(segment.charCount).toBe('Tom & "Léa" <ont> lu.'.length);
  });

  it('keeps every segment under the provider limit and loses no word, in order', () => {
    const pages = book(600);
    const segments = buildSsmlSegments(pages);
    expect(segments.length).toBeGreaterThan(10);
    for (const segment of segments) {
      expect(ssmlByteLength(segment.ssml)).toBeLessThanOrEqual(MAX_SSML_BYTES);
    }
    expect(segments.map((s) => s.index)).toEqual(segments.map((_, i) => i));
    const words = segments.flatMap((s) => s.words.map((w) => w.t));
    expect(words).toEqual(pages.flatMap((p) => p.text.split(/\s+/u)));
  });

  it('cuts between sentences and lets sentences cross page boundaries', () => {
    const segments = buildSsmlSegments(book(600, 5));
    for (const segment of segments.slice(0, -1)) {
      expect(segment.words.at(-1)?.t).toMatch(/\.$/u);
    }
    const crossing = buildSsmlSegments([
      { pageNumber: 1, text: 'Une phrase qui' },
      { pageNumber: 2, text: 'continue page deux.' },
    ]);
    expect(crossing).toHaveLength(1);
    expect(crossing[0].words.map((w) => w.p)).toEqual([1, 1, 1, 2, 2, 2]);
  });

  it('splits a sentence too long for one segment between words, and a giant word into pieces', () => {
    const long = Array.from({ length: 900 }, (_, i) => `mot${String(i)}`).join(' ');
    const segments = buildSsmlSegments([{ pageNumber: 1, text: `${long}.` }]);
    expect(segments.length).toBeGreaterThan(1);
    for (const segment of segments) {
      expect(ssmlByteLength(segment.ssml)).toBeLessThanOrEqual(MAX_SSML_BYTES);
    }
    const giant = buildSsmlSegments([{ pageNumber: 1, text: 'x'.repeat(MAX_WORD_LENGTH * 2 + 1) }]);
    expect(giant[0].words.map((w) => w.t.length)).toEqual([MAX_WORD_LENGTH, MAX_WORD_LENGTH, 1]);
  });

  it('produces nothing for blank pages', () => {
    expect(buildSsmlSegments([{ pageNumber: 1, text: ' \n ' }])).toEqual([]);
    expect(buildSsmlSegments([])).toEqual([]);
  });

  it('is deterministic: the same text always gives the same SSML (cache key)', () => {
    expect(buildSsmlSegments(book(200))).toEqual(buildSsmlSegments(book(200)));
  });

  it('re-synchronises after an edit: only segments near the correction change (RNF-26)', () => {
    const original = book(600);
    const edited = original.map((page) =>
      page.pageNumber === 2 ? { ...page, text: page.text.replace('élève', 'étudiant') } : page,
    );
    const before = new Set(buildSsmlSegments(original).map((s) => s.ssml));
    const after = buildSsmlSegments(edited);
    const changed = after.filter((s) => !before.has(s.ssml));
    expect(changed.length).toBeGreaterThan(0);
    expect(changed.length).toBeLessThanOrEqual(3);
    expect(after.length).toBeGreaterThan(20);
  });
});
