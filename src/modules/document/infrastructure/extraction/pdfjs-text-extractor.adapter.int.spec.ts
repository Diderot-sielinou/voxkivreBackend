import { buildPdf } from '../../../../../test/support/pdf-fixture';

import { PdfJsTextExtractor } from './pdfjs-text-extractor.adapter';

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
    expect(await extractor.extract(pdf)).toEqual([
      { lines: ['Chapitre 1 : Introduction', 'Le droit étudie l État, déjà, où, élève.'] },
      { lines: [] },
      { lines: ['Dernière page (fin).'] },
    ]);
  });

  it('returns null for a file that is not a readable PDF', async () => {
    expect(await extractor.extract(new TextEncoder().encode('%PDF-1.4 garbage'))).toBeNull();
  });

  it('does not keep a reference to the caller buffer (pdf.js transfers what it receives)', async () => {
    const pdf = buildPdf([['Bonjour']]);
    await extractor.extract(pdf);
    expect(pdf.byteLength).toBeGreaterThan(0);
    expect(await extractor.extract(pdf)).toEqual([{ lines: ['Bonjour'] }]);
  });

  it('extracts a 300-page book', async () => {
    const page = Array.from({ length: 40 }, (_, i) => `Ligne ${String(i)} du livre.`);
    const pages = await extractor.extract(buildPdf(Array.from({ length: 300 }, () => page)));
    expect(pages).toHaveLength(300);
    expect(pages?.[299]?.lines).toHaveLength(40);
  });
});
