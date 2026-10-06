import { ExtractionFailureReason } from '../value-objects/document-status.vo';

import {
  assemblePageText,
  countChars,
  MIN_AVG_CHARS_PER_PAGE,
  prepareExtractedText,
} from './extracted-text';

describe('assemblePageText', () => {
  it('normalises spaces and drops blank lines', () => {
    expect(assemblePageText(['  Chapitre   1 ', '', '   ', 'Suite\tdu texte'])).toBe(
      'Chapitre 1\nSuite du texte',
    );
  });

  it('rejoins a word hyphenated at the end of a line and keeps the rest of the line', () => {
    expect(assemblePageText(['ses li-', 'mites dans un État'])).toBe('ses limites\ndans un État');
    expect(assemblePageText(['un mot cou-', 'pé'])).toBe('un mot coupé');
  });

  it('keeps the hyphen before an uppercase word (compound names)', () => {
    expect(assemblePageText(['Jean-', 'Paul Sartre'])).toBe('Jean-\nPaul Sartre');
  });

  it('keeps a lone dash line untouched', () => {
    expect(assemblePageText(['-', 'texte'])).toBe('-\ntexte');
  });
});

describe('countChars', () => {
  it('counts every character except line breaks', () => {
    expect(countChars('ab\ncd é')).toBe(6);
  });
});

describe('prepareExtractedText', () => {
  const dense = (n: number) => ({ lines: ['x'.repeat(n)] });

  it('numbers pages from 1 and totals the characters', () => {
    const r = prepareExtractedText([dense(100), dense(60)]);
    expect(r).toEqual({
      ok: true,
      charCount: 160,
      pages: [
        { pageNumber: 1, text: 'x'.repeat(100), charCount: 100 },
        { pageNumber: 2, text: 'x'.repeat(60), charCount: 60 },
      ],
    });
  });

  it('fails as empty when the PDF has no page', () => {
    expect(prepareExtractedText([])).toEqual({ ok: false, reason: ExtractionFailureReason.EMPTY });
  });

  it('detects a scanned PDF by its average characters per page', () => {
    const almost = [dense(MIN_AVG_CHARS_PER_PAGE - 1), dense(MIN_AVG_CHARS_PER_PAGE - 1)];
    expect(prepareExtractedText(almost)).toEqual({
      ok: false,
      reason: ExtractionFailureReason.SCANNED,
    });
    expect(prepareExtractedText([dense(MIN_AVG_CHARS_PER_PAGE)]).ok).toBe(true);
    // Quelques pages blanches dans un vrai livre ne le font pas passer pour un scan.
    expect(prepareExtractedText([dense(2000), { lines: [] }, dense(2000)]).ok).toBe(true);
  });
});
