import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { prepareOcrText } from '../../domain/services/extracted-text';

import { TesseractOcrAdapter } from './tesseract-ocr.adapter';

/** PDF image de 2 pages, sans couche texte (scan), texte connu. */
const SCAN = new Uint8Array(
  readFileSync(join(__dirname, '../../../../../test/fixtures/ocr/scanned-2-pages.pdf')),
);

/**
 * Avec les vrais programmes (`pdftoppm`, `tesseract` + `fra`), installés par
 * l'image Docker et par le job CI d'intégration (ADR-0024).
 */
describe('TesseractOcrAdapter (integration, real Tesseract)', () => {
  const ocr = new TesseractOcrAdapter();

  it('recognises the French text of each page, with its position and confidence', async () => {
    const pages = await ocr.recognizePages(SCAN, 1, 2);

    expect(pages?.map((page) => page.pageNumber)).toEqual([1, 2]);
    const [first, second] = pages ?? [];
    expect(first.lines.map((line) => line.text)).toEqual(
      expect.arrayContaining([
        'Chapitre premier',
        'Le contrat est un accord de volontés.',
        'Sa validité suppose le consentement.',
      ]),
    );
    expect(second.lines.map((line) => line.text)).toContain('La responsabilité suppose une faute.');
    expect(first.confidence).toBeGreaterThan(0.8);
    // Le titre est plus grand que le corps, et placé au-dessus.
    const title = first.lines.find((line) => line.text === 'Chapitre premier');
    const body = first.lines.find((line) => line.text.startsWith('Le contrat'));
    expect(title?.fontSize ?? 0).toBeGreaterThan(body?.fontSize ?? 0);
    expect(title?.top ?? 1).toBeLessThan(body?.top ?? 0);
  }, 60_000);

  it('recognises only the pages of the batch', async () => {
    const pages = await ocr.recognizePages(SCAN, 2, 2);
    expect(pages?.map((page) => page.pageNumber)).toEqual([2]);
  }, 60_000);

  it('feeds the text cleaning: only the text of the page is kept, never its number', async () => {
    // Un chiffre isolé (« 1 ») est ignoré par Tesseract lui-même ; un numéro
    // plus long est reconnu puis mis de côté par le nettoyage (banc ADR-0024).
    const prepared = prepareOcrText((await ocr.recognizePages(SCAN, 1, 2)) ?? []);
    expect(prepared.ok && prepared.pages[0].text).toBe(
      'Chapitre premier\nLe contrat est un accord de volontés.\nSa validité suppose le consentement.',
    );
    expect(prepared.ok && prepared.pages[0].ocrConfidence).toBeGreaterThan(0.9);
  }, 60_000);

  it('answers null for a file poppler cannot open', async () => {
    expect(await ocr.recognizePages(new TextEncoder().encode('not a pdf'), 1, 1)).toBeNull();
  }, 60_000);
});
