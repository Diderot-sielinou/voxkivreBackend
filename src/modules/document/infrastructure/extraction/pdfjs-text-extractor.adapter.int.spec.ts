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
    expect(page.lines).toEqual([
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
