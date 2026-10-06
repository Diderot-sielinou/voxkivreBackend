import { dirname, join } from 'node:path';

import { Injectable } from '@nestjs/common';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

import { type PdfTextExtractorPort } from '../../domain/ports/pdf-text-extractor.port';
import { type ExtractedPageLines } from '../../domain/services/extracted-text';

/** Exceptions pdf.js qui décrivent le **fichier** (définitif), pas une panne. */
const UNREADABLE_PDF_ERRORS = new Set([
  'InvalidPDFException',
  'PasswordException',
  'MissingPDFException',
  'FormatError',
]);

// Polices standard livrées avec pdf.js : sans elles, pdf.js émet un warning
// par document (le texte reste extrait, mais on garde des logs propres).
const STANDARD_FONT_DATA_URL = `${join(dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts')}/`;

interface TextItemLike {
  readonly str?: string;
  readonly hasEOL?: boolean;
}

function isUnreadable(error: unknown): boolean {
  return error instanceof Error && UNREADABLE_PDF_ERRORS.has(error.name);
}

/**
 * Extraction du texte natif via pdf.js (Mozilla, Apache-2.0), page par page,
 * ligne par ligne (`hasEOL`). Les positions des fragments, fournies par
 * pdf.js, serviront à la lecture multi-colonnes (RF-03 complet).
 *
 * **Même processus que l'API** (ADR-0009) : on rend la main à la boucle
 * d'événements entre chaque page (`setImmediate`), pour qu'une extraction de
 * 300 pages n'affame pas les requêtes HTTP en cours.
 *
 * Sécurité : pdf.js ≥ 6 n'évalue plus aucun code issu du PDF (le chemin
 * `eval` de CVE-2024-4367 et son option `isEvalSupported` ont disparu ;
 * garder pdfjs-dist ≥ 6) ; aucune police système, aucun rendu.
 */
@Injectable()
export class PdfJsTextExtractor implements PdfTextExtractorPort {
  async extract(pdf: Uint8Array): Promise<readonly ExtractedPageLines[] | null> {
    // pdf.js "transfère" le buffer fourni : on lui donne une copie.
    const task = getDocument({
      data: new Uint8Array(pdf),
      disableFontFace: true,
      useSystemFonts: false,
      standardFontDataUrl: STANDARD_FONT_DATA_URL,
      verbosity: 0,
    });
    try {
      const document = await task.promise;
      const pages: ExtractedPageLines[] = [];
      for (let n = 1; n <= document.numPages; n += 1) {
        const page = await document.getPage(n);
        const content = await page.getTextContent();
        pages.push({ lines: toLines(content.items as readonly TextItemLike[]) });
        page.cleanup();
        await yieldToEventLoop();
      }
      return pages;
    } catch (error) {
      if (isUnreadable(error)) return null;
      throw error;
    } finally {
      await task.destroy();
    }
  }
}

/** Regroupe les fragments en lignes : `hasEOL` marque une fin de ligne. */
function toLines(items: readonly TextItemLike[]): string[] {
  const lines: string[] = [];
  let current = '';
  for (const item of items) {
    current += item.str ?? '';
    if (item.hasEOL === true) {
      lines.push(current);
      current = '';
    }
  }
  if (current.length > 0) lines.push(current);
  return lines;
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}
