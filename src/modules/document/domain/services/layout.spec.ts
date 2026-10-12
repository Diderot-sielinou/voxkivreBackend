import { findTableLines, restoreColumnOrder, tableRowText } from './layout';
import { type ExtractedLine, type LineSegment } from './text-cleaning';

/** Ligne à la hauteur `top`, faite de cellules `[texte, gauche, droite]`. */
function line(top: number, ...cells: (readonly [string, number, number])[]): ExtractedLine {
  const segments: LineSegment[] = cells.map(([text, left, right]) => ({ text, left, right }));
  return { text: segments.map((s) => s.text).join(' '), top, fontSize: 12, segments };
}

/** Ligne de texte courant d'une seule colonne. */
const prose = (top: number, left = 0.1, right = 0.9): ExtractedLine =>
  line(top, ['Le contrat est un accord de volontés destiné à créer des obligations.', left, right]);

describe('findTableLines', () => {
  it('finds a word-processor table: 3 aligned cells per row', () => {
    const rows = [
      line(0.68, ['Action', 0.095, 0.15], ['Délai', 0.365, 0.409], ['Article', 0.635, 0.691]),
      line(
        0.7,
        ['Nullité relative', 0.095, 0.217],
        ['5 ans', 0.365, 0.407],
        ['1304', 0.635, 0.675],
      ),
      line(
        0.72,
        ['Responsabilité', 0.095, 0.214],
        ['10 ans', 0.365, 0.417],
        ['2270-1', 0.635, 0.692],
      ),
    ];
    const lines = [prose(0.6), ...rows, prose(0.76)];

    expect([...findTableLines(lines)]).toEqual(rows);
  });

  it('accepts centred cells and rows with only 2 cells when one row has 3', () => {
    const rows = [
      line(0.1, ['method', 0.617, 0.663], ['error (%)', 0.78, 0.837]),
      line(0.12, ['Maxout [10]', 0.602, 0.678], ['9.38', 0.78, 0.807]),
      line(0.14, ['ResNet', 0.548, 0.593], ['20', 0.658, 0.674], ['8.75', 0.78, 0.807]),
    ];
    expect(findTableLines(rows).size).toBe(3);
  });

  it.each([
    [
      'two rows only',
      [
        line(0.1, ['a', 0.1, 0.2], ['b', 0.4, 0.5], ['c', 0.7, 0.8]),
        line(0.12, ['d', 0.1, 0.2], ['e', 0.4, 0.5], ['f', 0.7, 0.8]),
      ],
    ],
    [
      'text in two columns (long segments)',
      [0.1, 0.12, 0.14, 0.16].map((top) =>
        line(
          top,
          ['gauche : le contrat oblige les parties qui', 0.1, 0.45],
          ['droite : la faute engage son auteur envers', 0.55, 0.9],
          ['x', 0.92, 0.95],
        ),
      ),
    ],
    [
      'cells that do not line up',
      [
        line(0.1, ['a', 0.1, 0.15], ['b', 0.3, 0.35], ['c', 0.6, 0.65]),
        line(0.12, ['d', 0.2, 0.25], ['e', 0.45, 0.5], ['f', 0.8, 0.85]),
        line(0.14, ['g', 0.05, 0.08], ['h', 0.52, 0.55], ['i', 0.9, 0.93]),
      ],
    ],
    [
      'no row with 3 cells',
      [0.1, 0.12, 0.14].map((top) => line(top, ['a', 0.1, 0.2], ['b', 0.6, 0.7])),
    ],
  ])('ignores %s', (_case, lines) => {
    expect(findTableLines(lines).size).toBe(0);
  });

  it('ignores lines without geometry', () => {
    expect(findTableLines([{ text: 'a b c', top: 0.1, fontSize: 12 }]).size).toBe(0);
  });
});

describe('tableRowText', () => {
  it('joins the cells with a bar, so a row can be put back by hand', () => {
    expect(tableRowText(line(0.1, ['Paiement', 0.1, 0.2], ['2 ans', 0.4, 0.45]))).toBe(
      'Paiement | 2 ans',
    );
    expect(tableRowText({ text: 'sans géométrie', top: null, fontSize: null })).toBe(
      'sans géométrie',
    );
  });
});

describe('restoreColumnOrder', () => {
  /** Une page écrite en travers : chaque ligne porte la gauche puis la droite. */
  function interleaved(rows: number): ExtractedLine[] {
    return Array.from({ length: rows }, (_, i) =>
      line(
        0.2 + i * 0.02,
        [`gauche ${String(i + 1)}`, 0.12, 0.45],
        [`droite ${String(i + 1)}`, 0.55, 0.88],
      ),
    );
  }

  it('reads the left column, then the right one, after a full-width title', () => {
    const title = line(0.1, ['Titre sur toute la largeur', 0.12, 0.88]);
    const ordered = restoreColumnOrder([title, ...interleaved(6)], new Set());

    expect(ordered.map((l) => l.text)).toEqual([
      'Titre sur toute la largeur',
      ...[1, 2, 3, 4, 5, 6].map((n) => `gauche ${String(n)}`),
      ...[1, 2, 3, 4, 5, 6].map((n) => `droite ${String(n)}`),
    ]);
    expect(ordered[1]).toMatchObject({ top: 0.2, segments: [{ left: 0.12, right: 0.45 }] });
  });

  it('flushes both columns before a line that covers the gutter', () => {
    const lines = [
      ...interleaved(3),
      line(0.5, ['Intertitre pleine largeur', 0.12, 0.88]),
      ...interleaved(3),
    ];
    expect(restoreColumnOrder(lines, new Set()).map((l) => l.text)).toEqual([
      'gauche 1',
      'gauche 2',
      'gauche 3',
      'droite 1',
      'droite 2',
      'droite 3',
      'Intertitre pleine largeur',
      'gauche 1',
      'gauche 2',
      'gauche 3',
      'droite 1',
      'droite 2',
      'droite 3',
    ]);
  });

  it('leaves alone columns already written one after the other (LaTeX, Word)', () => {
    const left = [0.2, 0.22, 0.24, 0.26].map((top) => prose(top, 0.1, 0.46));
    const right = [0.2, 0.22, 0.24, 0.26].map((top) => prose(top, 0.54, 0.9));
    const lines = [...left, ...right];

    expect(restoreColumnOrder(lines, new Set())).toBe(lines);
  });

  it('keeps table rows in place and out of the column analysis', () => {
    const table = [0.3, 0.32, 0.34].map((top) =>
      line(top, ['a', 0.1, 0.15], ['b', 0.4, 0.45], ['c', 0.7, 0.75]),
    );
    const lines = [...[0.2, 0.22, 0.24, 0.26].map((top) => prose(top)), ...table];

    expect(restoreColumnOrder(lines, new Set(table))).toBe(lines);
  });

  it('needs at least 3 crossing lines and 30 % of the page', () => {
    const page = [
      ...interleaved(2),
      ...[0.5, 0.52, 0.54, 0.56].map((top) => prose(top, 0.1, 0.46)),
    ];
    expect(restoreColumnOrder(page, new Set())).toBe(page);
  });
});
