import { ExtractionFailureReason } from '../value-objects/document-status.vo';

import {
  assemblePageText,
  countChars,
  isScanned,
  MIN_AVG_CHARS_PER_PAGE,
  prepareExtractedText,
  prepareOcrText,
} from './extracted-text';
import { type ExtractedLine } from './text-cleaning';

/** Ligne sans position ni taille connues. */
const line = (text: string): ExtractedLine => ({ text, top: null, fontSize: null });

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
  const dense = (n: number) => ({ lines: [line('x'.repeat(n))] });

  it('numbers pages from 1 and totals the characters', () => {
    const r = prepareExtractedText([dense(100), dense(60)]);
    expect(r).toEqual({
      ok: true,
      charCount: 160,
      pages: [
        { pageNumber: 1, text: 'x'.repeat(100), charCount: 100, setAside: [], ocrConfidence: null },
        { pageNumber: 2, text: 'x'.repeat(60), charCount: 60, setAside: [], ocrConfidence: null },
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

describe('isScanned', () => {
  it('is false for a PDF without any page (that is an empty PDF, not a scan)', () => {
    expect(isScanned([])).toBe(false);
  });

  it('is true when the average raw text per page is under the threshold', () => {
    expect(isScanned([{ lines: [line('12')] }, { lines: [] }])).toBe(true);
    expect(isScanned([{ lines: [line('x'.repeat(MIN_AVG_CHARS_PER_PAGE))] }])).toBe(false);
  });
});

describe('prepareOcrText', () => {
  /** Ligne placée dans le corps de la page, police de corps. */
  const body = (text: string, top: number): ExtractedLine => ({ text, top, fontSize: 11 });

  it('cleans the recognised lines like a native page and keeps each page confidence', () => {
    const r = prepareOcrText([
      {
        pageNumber: 1,
        lines: [body('Le contrat est un accord.', 0.3), body('12', 0.95)],
        confidence: 0.95,
      },
      { pageNumber: 2, lines: [body('Sa validité suppose…', 0.3)], confidence: 0.71 },
      { pageNumber: 3, lines: [], confidence: null },
    ]);

    expect(r.ok && r.pages.map((p) => [p.pageNumber, p.text, p.ocrConfidence])).toEqual([
      [1, 'Le contrat est un accord.', 0.95],
      [2, 'Sa validité suppose…', 0.71],
      [3, '', null],
    ]);
    expect(r.ok && r.pages[0].setAside).toEqual([{ text: '12', reason: 'page_number' }]);
  });

  it('fails with ocr_no_text when no word was recognised at all', () => {
    expect(prepareOcrText([{ pageNumber: 1, lines: [], confidence: null }])).toEqual({
      ok: false,
      reason: ExtractionFailureReason.OCR_NO_TEXT,
    });
  });

  it('fails as empty without any page', () => {
    expect(prepareOcrText([])).toEqual({ ok: false, reason: ExtractionFailureReason.EMPTY });
  });
});
