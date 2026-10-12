import { buildOutline, detectHeadings, outlineFromBookmarks } from './outline';
import { type ExtractedLine } from './text-cleaning';

const line = (text: string, fontSize: number | null = 10, extra: Partial<ExtractedLine> = {}) => ({
  text,
  top: 0.5,
  fontSize,
  ...extra,
});

/** Corps de page : assez de texte en 10 pt pour fixer la taille du corps. */
const body = (n = 6): ExtractedLine[] =>
  Array.from({ length: n }, () =>
    line('Le contrat est un accord de volontés destiné à créer des obligations entre les parties.'),
  );

describe('detectHeadings', () => {
  it('ranks headings by font size, page by page', () => {
    const pages = [
      [line('Deep Residual Learning', 14.3), ...body(), line('1. Introduction', 12), ...body()],
      [line('3.1. Residual Learning', 11), ...body(), line('4. Experiments', 12), ...body()],
    ];
    expect(detectHeadings(pages)).toEqual([
      { title: 'Deep Residual Learning', level: 1, pageNumber: 1 },
      { title: '1. Introduction', level: 2, pageNumber: 1 },
      { title: '3.1. Residual Learning', level: 3, pageNumber: 2 },
      { title: '4. Experiments', level: 2, pageNumber: 2 },
    ]);
  });

  it('merges a heading wrapped on two lines', () => {
    const pages = [
      [line('Chapitre 2 : La formation', 16), line('du contrat de vente', 16), ...body()],
    ];
    expect(detectHeadings(pages)).toEqual([
      { title: 'Chapitre 2 : La formation du contrat de vente', level: 1, pageNumber: 1 },
    ]);
  });

  it('keeps a body-size heading only when it starts with a keyword', () => {
    const pages = [
      [
        line('Chapitre premier : les sources'),
        ...body(),
        line('Introduction'),
        line('1. Le contrat oblige.'),
        line('2.1 Une liste numérotée'),
        ...body(),
      ],
    ];
    expect(detectHeadings(pages).map((entry) => entry.title)).toEqual([
      'Chapitre premier : les sources',
      'Introduction',
    ]);
  });

  it('ignores vertical text, long lines, lines without letters and caps levels at 3', () => {
    const pages = [
      [
        line('arXiv:1512.03385v1 [cs.CV] 10 Dec 2015', 20, { vertical: true }),
        line('x'.repeat(130), 14),
        line('2015 — 47', 14),
        line('Niveau un', 18),
        line('Niveau deux', 16),
        line('Niveau trois', 14),
        line('Niveau quatre', 12),
        ...body(),
      ],
    ];
    expect(detectHeadings(pages)).toEqual([
      { title: 'Niveau un', level: 1, pageNumber: 1 },
      { title: 'Niveau deux', level: 2, pageNumber: 1 },
      { title: 'Niveau trois', level: 3, pageNumber: 1 },
      { title: 'Niveau quatre', level: 3, pageNumber: 1 },
    ]);
  });

  it('finds nothing without font sizes', () => {
    expect(detectHeadings([[line('Chapitre 1', null), line('Texte', null)]])).toEqual([]);
  });
});

describe('buildOutline', () => {
  const pages = [[line('Titre détecté', 16), ...body()]];

  it('prefers the PDF bookmarks, cleaned and capped at 3 levels', () => {
    expect(
      buildOutline(
        [
          { title: '  Chapitre   1 ', level: 1, pageNumber: 1 },
          { title: 'Trop profond', level: 4, pageNumber: 2 },
          { title: ' ', level: 1, pageNumber: 3 },
        ],
        pages,
      ),
    ).toEqual({ source: 'bookmarks', entries: [{ title: 'Chapitre 1', level: 1, pageNumber: 1 }] });
  });

  it('falls back on detected headings without bookmarks', () => {
    expect(buildOutline([], pages)).toEqual({
      source: 'headings',
      entries: [{ title: 'Titre détecté', level: 1, pageNumber: 1 }],
    });
    expect(outlineFromBookmarks([])).toEqual([]);
  });
});
