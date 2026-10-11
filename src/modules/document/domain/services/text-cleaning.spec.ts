import {
  cleanPages,
  type ExtractedLine,
  fingerprint,
  isCaption,
  isPageNumber,
} from './text-cleaning';

const BODY_SIZE = 12;
const SMALL_SIZE = 9;

const at = (text: string, top: number, fontSize = BODY_SIZE): ExtractedLine => ({
  text,
  top,
  fontSize,
});
const plain = (text: string): ExtractedLine => ({ text, top: null, fontSize: null });

/** Corps de page réaliste : 6 lignes de 60 à 70 caractères au milieu de la page. */
function body(page: number): ExtractedLine[] {
  return Array.from({ length: 6 }, (_, i) =>
    at(
      `Paragraphe ${String(page)}.${String(i)} : la responsabilité contractuelle suppose une faute.`,
      0.2 + i * 0.08,
    ),
  );
}

/** Un cours de `count` pages : en-tête, corps, numéro de page en bas. */
function course(count: number, extra: (page: number) => ExtractedLine[] = () => []) {
  return Array.from({ length: count }, (_, i) => {
    const page = i + 1;
    return [
      at('Université de Yaoundé II — Droit des obligations', 0.05, SMALL_SIZE),
      ...body(page),
      ...extra(page),
      at(String(page), 0.95, SMALL_SIZE),
    ];
  });
}

const texts = (lines: readonly ExtractedLine[]) => lines.map((line) => line.text);

/** Mots distincts : deux lignes de corps ne doivent pas avoir la même empreinte. */
const WORDS = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel'];

describe('fingerprint', () => {
  it('ignores case, accents, digits and punctuation', () => {
    expect(fingerprint('Droit des Obligations — 47')).toBe(
      fingerprint('droit des obligations - 48'),
    );
    expect(fingerprint('Chapitre 2 : Évolution')).toBe('chapitre#evolution');
    expect(fingerprint('— 12 —')).toBe('#');
    expect(fingerprint('...')).toBe('');
  });
});

describe('isPageNumber', () => {
  it.each([
    '12',
    '- 12 -',
    '— 7 —',
    'Page 12',
    'page 3',
    'p. 12',
    '12/300',
    '12 / 300',
    '12 sur 300',
    'xii',
    'XIV',
    'iv',
  ])('recognises %s', (text) => {
    expect(isPageNumber(text)).toBe(true);
  });

  it.each(['Chapitre 12', '12 juillet 1998', 'Article 1240', 'mille', 'Introduction', '12345'])(
    'leaves %s',
    (text) => {
      expect(isPageNumber(text)).toBe(false);
    },
  );
});

describe('isCaption', () => {
  it.each([
    'Figure 3 : Schéma de la responsabilité',
    'Fig. 2 – Organigramme',
    'Tableau 1. Répartition des sièges',
    'Graphique 4 : Évolution du PIB',
    'Schéma 2 — Procédure',
    'Source : INS, 2023',
    'Figure n° 5 : Carte',
  ])('recognises %s', (text) => {
    expect(isCaption(text)).toBe(true);
  });

  it.each([
    'Tableau 2 montre que la croissance ralentit.',
    'La figure 3 illustre ce point.',
    'Sources du droit',
    `Figure 1 : ${'x'.repeat(250)}`,
  ])('leaves %s', (text) => {
    expect(isCaption(text)).toBe(false);
  });
});

describe('cleanPages', () => {
  it('sets aside a repeated header and page numbers, and keeps the body', () => {
    const cleaned = cleanPages(course(5));

    for (const [i, page] of cleaned.entries()) {
      expect(texts(page.kept)).toStrictEqual(texts(body(i + 1)));
      expect(page.setAside).toStrictEqual([
        { text: 'Université de Yaoundé II — Droit des obligations', reason: 'header' },
        { text: String(i + 1), reason: 'page_number' },
      ]);
    }
  });

  it('sets aside a page number even in a one-page document', () => {
    const [page] = cleanPages([[...body(1), at('- 1 -', 0.96)]]);
    expect(page.setAside).toStrictEqual([{ text: '- 1 -', reason: 'page_number' }]);
  });

  it('keeps a number that is not in a margin', () => {
    const [page] = cleanPages([[...body(1), at('1998', 0.6)]]);
    expect(page.setAside).toStrictEqual([]);
  });

  it('handles alternating headers (book title on even pages, chapter on odd pages)', () => {
    const pages = Array.from({ length: 8 }, (_, i) => [
      at(i % 2 === 0 ? 'DROIT CIVIL' : 'Chapitre 2 — Les contrats', 0.04, SMALL_SIZE),
      ...body(i + 1),
    ]);
    for (const page of cleanPages(pages)) {
      expect(page.setAside).toHaveLength(1);
      expect(page.setAside[0].reason).toBe('header');
    }
  });

  it('handles a running header that changes with each chapter', () => {
    const pages = Array.from({ length: 12 }, (_, i) => [
      at(i < 6 ? 'Chapitre 1 — Les sources' : 'Chapitre 2 — Les contrats', 0.04, SMALL_SIZE),
      ...body(i + 1),
    ]);
    expect(cleanPages(pages).every((page) => page.setAside[0]?.reason === 'header')).toBe(true);
  });

  it('keeps a margin line repeated on only two pages, or too far apart', () => {
    const pages = Array.from({ length: 12 }, (_, i) => [
      ...(i === 0 || i === 1 || i === 9 ? [at('Note importante', 0.05)] : []),
      ...body(i + 1),
    ]);
    expect(cleanPages(pages).flatMap((page) => page.setAside)).toStrictEqual([]);
  });

  it('sets aside a repeated footer as footer', () => {
    const pages = Array.from({ length: 4 }, (_, i) => [
      ...body(i + 1),
      at('© Éditions Clé, Yaoundé', 0.93, SMALL_SIZE),
    ]);
    for (const page of cleanPages(pages)) {
      expect(page.setAside).toStrictEqual([{ text: '© Éditions Clé, Yaoundé', reason: 'footer' }]);
    }
  });

  it('sets aside a footnote block in a smaller font, starting with a call', () => {
    const [page] = cleanPages([
      [
        ...body(1),
        at('1 Cass. civ., 12 mai 1998, Bull. civ. I, n° 152.', 0.86, SMALL_SIZE),
        at('suite de la note sur une seconde ligne', 0.88, SMALL_SIZE),
        at('² Voir aussi l’article 1240 du Code civil.', 0.9, SMALL_SIZE),
      ],
    ]);
    expect(texts(page.kept)).toStrictEqual(texts(body(1)));
    expect(page.setAside.map((line) => line.reason)).toStrictEqual([
      'footnote',
      'footnote',
      'footnote',
    ]);
  });

  it('does not take a small-font line in the upper half for a footnote', () => {
    const [page] = cleanPages([[at('1 Encadré : définition', 0.3, SMALL_SIZE), ...body(1)]]);
    expect(page.setAside).toStrictEqual([]);
  });

  it('does not take a body-size numbered line for a footnote', () => {
    const [page] = cleanPages([[...body(1), at('1 Première condition de validité.', 0.8)]]);
    expect(page.setAside).toStrictEqual([]);
  });

  it('stops a footnote block at the first body-size line', () => {
    const [page] = cleanPages([
      [
        ...body(1),
        at('* Note de l’éditeur.', 0.75, SMALL_SIZE),
        at('Retour au corps du texte pour terminer la page.', 0.8),
        at('petite ligne après', 0.85, SMALL_SIZE),
      ],
    ]);
    expect(page.setAside).toStrictEqual([{ text: '* Note de l’éditeur.', reason: 'footnote' }]);
  });

  it('sets aside captions anywhere on the page', () => {
    const [page] = cleanPages([[...body(1), at('Figure 3 : Schéma de la procédure', 0.5)]]);
    expect(page.setAside).toStrictEqual([
      { text: 'Figure 3 : Schéma de la procédure', reason: 'caption' },
    ]);
  });

  it('leaves a page intact when cleaning would remove more than half of it', () => {
    // Diaporama : chaque page répète un long titre et n'a qu'une courte ligne.
    const slides = Array.from({ length: 4 }, (_, i) => [
      at('Introduction au droit des obligations — Licence 2', 0.05, 20),
      at(`Point ${String(i + 1)}`, 0.5, 20),
    ]);
    for (const [i, page] of cleanPages(slides).entries()) {
      expect(page.setAside).toStrictEqual([]);
      expect(texts(page.kept)).toStrictEqual(texts(slides[i]));
    }
  });

  it('uses the first and last two lines as margins when positions are unknown', () => {
    const pages = Array.from({ length: 4 }, (_, i) => [
      plain('Cours de droit — L2'),
      ...Array.from({ length: 6 }, (__, j) =>
        plain(`${WORDS[i]} ${WORDS[j]} : ligne du corps propre à cette page, assez longue.`),
      ),
      plain(`Page ${String(i + 1)}`),
    ]);
    for (const page of cleanPages(pages)) {
      expect(page.setAside.map((line) => line.reason)).toStrictEqual(['header', 'page_number']);
    }
  });

  it('has no margin without positions on a short page, and finds no footnote', () => {
    const [page] = cleanPages([[plain('3'), plain('Une phrase.'), plain('1 Une note ?')]]);
    expect(page.setAside).toStrictEqual([]);
  });

  it('normalises spaces and drops empty lines', () => {
    const [page] = cleanPages([[at('  Un   texte  ', 0.5), at('   ', 0.6), at('', 0.7)]]);
    expect(texts(page.kept)).toStrictEqual(['Un texte']);
  });

  it('handles empty pages and an empty document', () => {
    expect(cleanPages([])).toStrictEqual([]);
    expect(cleanPages([[]])).toStrictEqual([{ kept: [], setAside: [] }]);
  });

  it('never treats a long margin line as a repeated header', () => {
    const long = 'x'.repeat(220);
    const pages = Array.from({ length: 4 }, (_, i) => [at(long, 0.05), ...body(i + 1)]);
    expect(cleanPages(pages).flatMap((page) => page.setAside)).toStrictEqual([]);
  });
});
