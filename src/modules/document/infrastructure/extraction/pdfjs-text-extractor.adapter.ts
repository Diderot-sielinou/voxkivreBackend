import { dirname, join } from 'node:path';

import { Injectable } from '@nestjs/common';
import { getDocument, type PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';

import {
  type ExtractedPdf,
  type PdfTextExtractorPort,
} from '../../domain/ports/pdf-text-extractor.port';
import { type ExtractedPageLines } from '../../domain/services/extracted-text';
import { MAX_OUTLINE_LEVEL, type OutlineEntry } from '../../domain/services/outline';
import { type ExtractedLine, type LineSegment } from '../../domain/services/text-cleaning';

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

/**
 * Deux fragments séparés d'au moins 1 em (la taille de la police) sont deux
 * segments : cellules de tableau ou colonnes (ADR-0025). Un espace entre
 * mots, même étiré par la justification, reste bien en dessous.
 */
const SEGMENT_GAP_EM = 1;
/** En dessous, deux fragments se touchent (pas d'espace inséré entre eux). */
const WORD_GAP_EM = 0.1;

interface TextItemLike {
  readonly str?: string;
  readonly hasEOL?: boolean;
  /** Largeur du fragment en unités de la page. */
  readonly width?: number;
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
  async extract(pdf: Uint8Array): Promise<ExtractedPdf | null> {
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
      return { pages, bookmarks: await readBookmarks(document) };
    } catch (error) {
      if (isUnreadable(error)) return null;
      throw error;
    } finally {
      await task.destroy();
    }
  }
}

/** Un signet tel que le rend pdf.js (types partiels de la bibliothèque). */
interface OutlineNode {
  readonly title?: string;
  readonly dest?: string | readonly unknown[] | null;
  readonly items?: readonly OutlineNode[];
}

/**
 * Signets du PDF, mis à plat sur 3 niveaux, avec leur page (ADR-0027). Un
 * signet sans page résoluble est ignoré ; une erreur ne fait pas échouer
 * l'extraction (pas de table plutôt que pas de texte).
 */
async function readBookmarks(document: PDFDocumentProxy): Promise<OutlineEntry[]> {
  const entries: OutlineEntry[] = [];
  const walk = async (nodes: readonly OutlineNode[], level: number): Promise<void> => {
    for (const node of nodes) {
      const pageNumber = await pageOf(document, node.dest);
      const title = (node.title ?? '').trim();
      if (pageNumber !== null && title !== '') entries.push({ title, level, pageNumber });
      if (level < MAX_OUTLINE_LEVEL) await walk(node.items ?? [], level + 1);
    }
  };
  try {
    // Les types de pdf.js promettent un tableau ; il rend `null` sans signets.
    const outline: unknown = await document.getOutline();
    await walk(isOutline(outline) ? outline : [], 1);
  } catch {
    // Signets illisibles : la table sera détectée à partir des titres.
    return [];
  }
  return entries;
}

function isOutline(value: unknown): value is readonly OutlineNode[] {
  return Array.isArray(value);
}

async function pageOf(
  document: PDFDocumentProxy,
  dest: OutlineNode['dest'],
): Promise<number | null> {
  const explicit: readonly unknown[] | null | undefined =
    typeof dest === 'string' ? await document.getDestination(dest) : dest;
  const reference = explicit?.[0];
  if (reference === undefined || reference === null) return null;
  // `getPageIndex` attend une référence d'objet `{ num, gen }` rendue par pdf.js.
  return (
    (await document.getPageIndex(reference as Parameters<PDFDocumentProxy['getPageIndex']>[0])) + 1
  );
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
  const fontSize = Math.hypot(c, d);
  const segments = toSegments(items, viewBox, fontSize);
  // Matrice tournée d'un quart de tour : texte vertical (tampon de marge, ADR-0027).
  const vertical = Math.abs(transform[1]) > Math.abs(transform[0]);
  return {
    text,
    top: height > 0 ? clamp01((top - baseline) / height) : null,
    fontSize,
    ...(segments.length > 0 ? { segments } : {}),
    ...(vertical ? { vertical } : {}),
  };
}

/**
 * Regroupe les fragments de la ligne, de gauche à droite, en segments
 * séparés d'au moins 1 em (ADR-0025). Les fragments blancs ne comptent pas.
 */
function toSegments(
  items: readonly TextItemLike[],
  viewBox: ViewBox,
  fontSize: number,
): LineSegment[] {
  const left = viewBox[0];
  const width = viewBox[2] - viewBox[0];
  if (width <= 0 || fontSize <= 0) return [];
  const boxes = items
    .filter((item) => (item.str ?? '').trim() !== '' && item.transform?.length === 6)
    .map((item) => {
      const x0 = item.transform?.[4] ?? 0;
      return { text: item.str ?? '', x0, x1: x0 + Math.max(0, item.width ?? 0) };
    })
    .toSorted((a, b) => a.x0 - b.x0);

  const segments: { text: string; x0: number; x1: number }[] = [];
  for (const box of boxes) {
    const last = segments.at(-1);
    const gap = last === undefined ? Infinity : box.x0 - last.x1;
    if (last === undefined || gap >= SEGMENT_GAP_EM * fontSize) {
      segments.push({ ...box });
      continue;
    }
    const joiner = gap > WORD_GAP_EM * fontSize ? ' ' : '';
    last.text = `${last.text}${joiner}${box.text}`;
    last.x1 = Math.max(last.x1, box.x1);
  }
  return segments.map((segment) => ({
    text: segment.text.replaceAll(/\s+/gu, ' ').trim(),
    left: clamp01((segment.x0 - left) / width),
    right: clamp01((segment.x1 - left) / width),
  }));
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}
