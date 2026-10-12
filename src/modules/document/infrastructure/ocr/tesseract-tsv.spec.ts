import { parseTesseractTsv } from './tesseract-tsv';

const HEADER =
  'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext';

/** Ligne TSV : `[level, block, par, line, word, top, height, conf, text]`. */
type Row = readonly [number, number, number, number, number, number, number, number, string];

function tsv(rows: readonly Row[]): string {
  return [
    HEADER,
    ...rows.map(([level, block, par, line, word, top, height, conf, text]) =>
      [level, 1, block, par, line, word, 0, top, 100, height, conf, text].join('\t'),
    ),
  ].join('\n');
}

describe('parseTesseractTsv', () => {
  // Page de 2 000 px de haut : un en-tête, deux lignes de corps, un mot vide.
  const page = tsv([
    [1, 0, 0, 0, 0, 0, 2000, -1, ''],
    [4, 1, 1, 1, 0, 80, 40, -1, ''],
    [5, 1, 1, 1, 1, 82, 20, 96.5, 'Université'],
    [5, 1, 1, 1, 2, 84, 18, 93.5, 'II'],
    [4, 2, 1, 1, 0, 400, 90, -1, ''],
    [5, 2, 1, 1, 1, 402, 30, 90, 'Le'],
    [5, 2, 1, 1, 2, 404, 31, 80, 'contrat'],
    [5, 2, 1, 1, 3, 401, 29, 70, 'lie.'],
    [4, 2, 1, 2, 0, 460, 30, -1, ''],
    [5, 2, 1, 2, 1, 460, 30, -1, ' '],
  ]);

  it('groups words into lines in reading order, skipping lines without words', () => {
    expect(parseTesseractTsv(page).lines.map((line) => line.text)).toEqual([
      'Université II',
      'Le contrat lie.',
    ]);
  });

  it('places each line on the page and sizes it from the median word height', () => {
    const [header, body] = parseTesseractTsv(page).lines;
    expect(header.top).toBeCloseTo(0.04);
    expect(body.top).toBeCloseTo(0.2);
    // Hauteur médiane du corps : 30 px sur 2 000 → 30/2000 × 842 pt ; la boîte
    // de la ligne (90 px, gonflée par la rotation) n'est pas prise.
    expect(body.fontSize).toBeCloseTo((30 / 2000) * 842);
    expect(header.fontSize ?? 0).toBeLessThan(body.fontSize ?? 0);
  });

  it('averages the word confidences into 0–1, ignoring the -1 of blank words', () => {
    // (96.5 + 93.5 + 90 + 80 + 70) / 5 = 86 → 0.86
    expect(parseTesseractTsv(page).confidence).toBeCloseTo(0.86);
  });

  it('gives no line and no confidence for a page without any word', () => {
    expect(parseTesseractTsv(tsv([[1, 0, 0, 0, 0, 0, 2000, -1, '']]))).toEqual({
      lines: [],
      confidence: null,
    });
    expect(parseTesseractTsv('')).toEqual({ lines: [], confidence: null });
  });

  it('ignores malformed rows', () => {
    expect(parseTesseractTsv(`${HEADER}\n5\t1\tbroken`).lines).toEqual([]);
  });
});
