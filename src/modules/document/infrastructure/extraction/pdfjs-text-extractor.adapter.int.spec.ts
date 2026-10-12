import { buildPdf } from '../../../../../test/support/pdf-fixture';
import { cleanPages } from '../../domain/services/text-cleaning';

import { PdfJsTextExtractor } from './pdfjs-text-extractor.adapter';

/** Hauteur d'une page A4 en points (MediaBox du générateur de test). */
const PAGE_HEIGHT = 842;

const texts = (page: { readonly lines: readonly { readonly text: string }[] }) =>
  page.lines.map((line) => line.text);

/**
 * Contre la vraie bibliothèque pdf.js (pas de service externe, mais du code
 * ESM tiers qu'un mock ne prouverait pas). Fichier `.int` : la config
 * d'intégration transforme les `.mjs`.
 */
describe('PdfJsTextExtractor (integration)', () => {
  const extractor = new PdfJsTextExtractor();

  it('extracts the text line by line, page by page, keeping French accents', async () => {
    const pdf = buildPdf([
      ['Chapitre 1 : Introduction', 'Le droit étudie l État, déjà, où, élève.'],
      null,
      ['Dernière page (fin).'],
    ]);
    const pages = await extractor.extract(pdf);
    expect(pages?.map((page) => texts(page))).toEqual([
      ['Chapitre 1 : Introduction', 'Le droit étudie l État, déjà, où, élève.'],
      [],
      ['Dernière page (fin).'],
    ]);
  });

  it('gives each line its vertical position (0 at the top) and its font size', async () => {
    const pdf = buildPdf([
      [
        { text: 'En-tête du cours', y: 800, size: 9 },
        { text: 'Corps du texte au milieu.', y: 421, size: 12 },
        { text: '1 Une note de bas de page.', y: 90, size: 8 },
      ],
    ]);
    const [page] = (await extractor.extract(pdf)) ?? [];
    expect(page.lines).toMatchObject([
      { text: 'En-tête du cours', top: expect.closeTo(42 / PAGE_HEIGHT, 3) as number, fontSize: 9 },
      { text: 'Corps du texte au milieu.', top: expect.closeTo(0.5, 3) as number, fontSize: 12 },
      {
        text: '1 Une note de bas de page.',
        top: expect.closeTo(752 / PAGE_HEIGHT, 3) as number,
        fontSize: 8,
      },
    ]);
  });

  it('cleans a real course: repeated header, page numbers and footnotes set aside', async () => {
    const pdf = buildPdf(
      Array.from({ length: 4 }, (_, i) => [
        { text: 'Université de Yaoundé II — Droit des obligations', y: 810, size: 9 },
        {
          text: `Le contrat ${String(i + 1)} lie les parties qui l'ont conclu de bonne foi1.`,
          y: 700,
        },
        {
          text: `La responsabilité ${String(i + 1)} suppose une faute, un dommage et un lien.`,
          y: 684,
        },
        { text: `1 Cass. civ., ${String(i + 1)} mai 1998.`, y: 100, size: 8 },
        { text: String(i + 1), y: 40, size: 9 },
      ]),
    );
    const pages = (await extractor.extract(pdf)) ?? [];
    const cleaned = cleanPages(pages.map((page) => page.lines));
    for (const [i, page] of cleaned.entries()) {
      expect(page.kept.map((line) => line.text)).toEqual([
        `Le contrat ${String(i + 1)} lie les parties qui l'ont conclu de bonne foi1.`,
        `La responsabilité ${String(i + 1)} suppose une faute, un dommage et un lien.`,
      ]);
      expect(page.setAside.map((line) => line.reason)).toEqual([
        'header',
        'footnote',
        'page_number',
      ]);
    }
  });

  it('gives each line its horizontal segments, split by gaps of at least 1 em', async () => {
    const pdf = buildPdf([
      [
        { text: 'Nullité relative', y: 700, x: 60 },
        { text: '5 ans', y: 700, x: 220 },
        { text: '1304', y: 700, x: 380 },
        { text: 'Une phrase entière ne fait qu’un segment.', y: 680, x: 60 },
      ],
    ]);
    const [page] = (await extractor.extract(pdf)) ?? [];

    expect(page.lines[0].segments?.map((s) => s.text)).toEqual([
      'Nullité relative',
      '5 ans',
      '1304',
    ]);
    expect(page.lines[0].segments?.[1].left).toBeCloseTo(220 / 595, 2);
    expect(page.lines[1].segments).toHaveLength(1);
  });

  it('cleans a handout: table set aside, columns written across the page put back in order', async () => {
    const across = Array.from({ length: 8 }, (_, i) => [
      { text: `gauche ${String(i + 1)} : le contrat oblige les parties`, y: 700 - i * 16, x: 60 },
      { text: `droite ${String(i + 1)} : la faute engage son auteur`, y: 700 - i * 16, x: 320 },
    ]).flat();
    const table = [
      ['Action', 'Délai', 'Article'],
      ['Nullité relative', '5 ans', '1304'],
      ['Paiement', '2 ans', '2272'],
    ].flatMap((cells, i) => cells.map((text, j) => ({ text, y: 500 - i * 16, x: 60 + j * 160 })));
    const pdf = buildPdf([
      [
        { text: 'Droit des obligations, chapitre 2, sur toute la largeur', y: 760, x: 60 },
        ...across,
        ...table,
      ],
    ]);

    const [page] = cleanPages(((await extractor.extract(pdf)) ?? []).map((p) => p.lines));

    expect(page.kept.map((line) => line.text)).toEqual([
      'Droit des obligations, chapitre 2, sur toute la largeur',
      ...Array.from(
        { length: 8 },
        (_, i) => `gauche ${String(i + 1)} : le contrat oblige les parties`,
      ),
      ...Array.from(
        { length: 8 },
        (_, i) => `droite ${String(i + 1)} : la faute engage son auteur`,
      ),
    ]);
    expect(page.setAside).toEqual([
      { text: 'Action | Délai | Article', reason: 'table' },
      { text: 'Nullité relative | 5 ans | 1304', reason: 'table' },
      { text: 'Paiement | 2 ans | 2272', reason: 'table' },
    ]);
  });

  it('returns null for a file that is not a readable PDF', async () => {
    expect(await extractor.extract(new TextEncoder().encode('%PDF-1.4 garbage'))).toBeNull();
  });

  it('does not keep a reference to the caller buffer (pdf.js transfers what it receives)', async () => {
    const pdf = buildPdf([['Bonjour']]);
    await extractor.extract(pdf);
    expect(pdf.byteLength).toBeGreaterThan(0);
    const pages = await extractor.extract(pdf);
    expect(pages?.map((page) => texts(page))).toEqual([['Bonjour']]);
  });

  it('extracts a 300-page book', async () => {
    const page = Array.from({ length: 40 }, (_, i) => `Ligne ${String(i)} du livre.`);
    const pages = await extractor.extract(buildPdf(Array.from({ length: 300 }, () => page)));
    expect(pages).toHaveLength(300);
    expect(pages?.[299]?.lines).toHaveLength(40);
  });
});
