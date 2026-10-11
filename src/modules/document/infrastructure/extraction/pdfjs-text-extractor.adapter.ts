import { dirname, join } from 'node:path';

import { Injectable } from '@nestjs/common';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

import { type PdfTextExtractorPort } from '../../domain/ports/pdf-text-extractor.port';
import { type ExtractedPageLines } from '../../domain/services/extracted-text';
import { type ExtractedLine } from '../../domain/services/text-cleaning';

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
  /** Matrice `[a, b, c, d, e, f]` : `f` = ligne de base (depuis le bas), `hypot(c, d)` = taille. */
  readonly transform?: readonly number[];
}

/** Boîte de la page en points PDF : `[x0, y0, x1, y1]` (origine en bas à gauche). */
type ViewBox = readonly number[];

function isUnreadable(error: unknown): boolean {
  return error instanceof Error && UNREADABLE_PDF_ERRORS.has(error.name);
}

/**
 * Extraction du texte natif via pdf.js (Mozilla, Apache-2.0), page par page,
 * ligne par ligne (`hasEOL`), avec la position verticale et la taille de
 * police de chaque ligne (nettoyage, ADR-0022 ; multi-colonnes, RF-03).
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
        const { viewBox } = page.getViewport({ scale: 1 });
        pages.push({ lines: toLines(content.items as readonly TextItemLike[], viewBox) });
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

/**
 * Regroupe les fragments en lignes (`hasEOL` marque une fin de ligne). La
 * position et la taille d'une ligne sont celles de son fragment le plus long
 * (un appel de note en exposant ne doit pas la définir).
 */
function toLines(items: readonly TextItemLike[], viewBox: ViewBox): ExtractedLine[] {
  const lines: ExtractedLine[] = [];
  let current: TextItemLike[] = [];
  const flush = (): void => {
    // Les lignes vides sont gardées ici ; le nettoyage les retire.
    lines.push(toLine(current.map((item) => item.str ?? '').join(''), current, viewBox));
    current = [];
  };
  for (const item of items) {
    current.push(item);
    if (item.hasEOL === true) flush();
  }
  if (current.some((item) => (item.str ?? '').length > 0)) flush();
  return lines;
}

function toLine(text: string, items: readonly TextItemLike[], viewBox: ViewBox): ExtractedLine {
  const main = items.reduce<TextItemLike | null>(
    (longest, item) =>
      longest === null || (item.str ?? '').length > (longest.str ?? '').length ? item : longest,
    null,
  );
  const transform = main?.transform;
  if (transform?.length !== 6) return { text, top: null, fontSize: null };
  const c = transform[2];
  const d = transform[3];
  const baseline = transform[5];
  const bottom = viewBox[1];
  const top = viewBox[3];
  const height = top - bottom;
  return {
    text,
    top: height > 0 ? clamp01((top - baseline) / height) : null,
    fontSize: Math.hypot(c, d),
  };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}
