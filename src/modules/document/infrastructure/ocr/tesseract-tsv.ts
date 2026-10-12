import { type ExtractedLine, type LineSegment } from '../../domain/services/text-cleaning';

/** Hauteur d'une page A4 en points : `fontSize` est exprimé comme sur un PDF natif. */
const A4_HEIGHT_PT = 842;

/** Niveaux de la sortie TSV de Tesseract. */
const LEVEL_PAGE = 1;
const LEVEL_LINE = 4;
const LEVEL_WORD = 5;

/**
 * Deux mots séparés de plus de 1,2 hauteur de mot (≈ 1 em : une boîte de
 * mot mesure ~0,7 em) sont deux segments : cellules ou colonnes (ADR-0025).
 */
const SEGMENT_GAP_HEIGHTS = 1.2;

/** Colonnes : level page_num block_num par_num line_num word_num left top width height conf text. */
const COLUMN_COUNT = 12;

interface TsvRow {
  readonly level: number;
  /** `bloc.paragraphe.ligne` : relie un mot à sa ligne. */
  readonly lineKey: string;
  readonly left: number;
  readonly width: number;
  readonly top: number;
  readonly height: number;
  readonly conf: number;
  readonly text: string;
}

export interface RecognizedPage {
  readonly lines: readonly ExtractedLine[];
  /** Moyenne des confiances des mots, de 0 à 1 ; `null` sans aucun mot. */
  readonly confidence: number | null;
}

/**
 * Lit la sortie `tsv` de Tesseract (ADR-0024) : mots regroupés par ligne,
 * dans l'ordre de lecture du moteur. Une ligne porte sa position verticale
 * (haut de la ligne / hauteur de page) et une taille de police : la hauteur
 * **médiane de ses mots** (la boîte d'une longue ligne d'un scan de travers
 * est gonflée par la rotation), ramenée à une page A4. Le nettoyage
 * (ADR-0022) ne compare que des tailles relatives au corps du texte.
 */
export function parseTesseractTsv(tsv: string): RecognizedPage {
  const rows = tsv
    .split('\n')
    .slice(1) // en-tête
    .map((line) => toRow(line))
    .filter((row): row is TsvRow => row !== null);

  const page = rows.find((row) => row.level === LEVEL_PAGE);
  const size = { height: page?.height ?? 0, width: page?.width ?? 0 };
  const words = rows.filter((row) => row.level === LEVEL_WORD && row.text.trim() !== '');
  const wordsByLine = groupByLine(words);

  const lines: ExtractedLine[] = [];
  for (const row of rows) {
    const lineWords = row.level === LEVEL_LINE ? wordsByLine.get(row.lineKey) : undefined;
    if (lineWords !== undefined) lines.push(toLine(row, lineWords, size));
  }

  const scored = words.filter((word) => word.conf >= 0);
  const confidence =
    scored.length === 0
      ? null
      : round3(scored.reduce((sum, word) => sum + word.conf, 0) / scored.length / 100);
  return { lines, confidence };
}

function groupByLine(words: readonly TsvRow[]): ReadonlyMap<string, TsvRow[]> {
  const byLine = new Map<string, TsvRow[]>();
  for (const word of words) {
    const group = byLine.get(word.lineKey);
    if (group === undefined) byLine.set(word.lineKey, [word]);
    else group.push(word);
  }
  return byLine;
}

function toLine(
  row: TsvRow,
  words: readonly TsvRow[],
  page: { readonly height: number; readonly width: number },
): ExtractedLine {
  const wordHeight = median(words.map((w) => w.height));
  const segments = page.width > 0 ? toSegments(words, wordHeight, page.width) : [];
  return {
    text: words.map((word) => word.text.trim()).join(' '),
    top: page.height > 0 ? clamp01(row.top / page.height) : null,
    fontSize: page.height > 0 ? (wordHeight / page.height) * A4_HEIGHT_PT : null,
    ...(segments.length > 0 ? { segments } : {}),
  };
}

/** Mots de gauche à droite, regroupés tant que l'écart reste sous ~1 em. */
function toSegments(
  words: readonly TsvRow[],
  wordHeight: number,
  pageWidth: number,
): LineSegment[] {
  const sorted = words.toSorted((a, b) => a.left - b.left);
  const segments: { text: string; x0: number; x1: number }[] = [];
  for (const word of sorted) {
    const last = segments.at(-1);
    const x1 = word.left + word.width;
    if (last === undefined || word.left - last.x1 > SEGMENT_GAP_HEIGHTS * wordHeight) {
      segments.push({ text: word.text.trim(), x0: word.left, x1 });
      continue;
    }
    last.text = `${last.text} ${word.text.trim()}`;
    last.x1 = Math.max(last.x1, x1);
  }
  return segments.map((segment) => ({
    text: segment.text,
    left: clamp01(segment.x0 / pageWidth),
    right: clamp01(segment.x1 / pageWidth),
  }));
}

function toRow(line: string): TsvRow | null {
  const cells = line.split('\t');
  if (cells.length < COLUMN_COUNT) return null;
  const level = Number(cells[0]);
  const left = Number(cells[6]);
  const top = Number(cells[7]);
  const width = Number(cells[8]);
  const height = Number(cells[9]);
  const conf = Number(cells[10]);
  if (![level, left, top, width, height, conf].every((n) => Number.isFinite(n))) return null;
  return {
    level,
    lineKey: `${cells[2]}.${cells[3]}.${cells[4]}`,
    left,
    width,
    top,
    height,
    conf,
    // Un mot ne contient pas de tabulation : le reste de la ligne est le texte.
    text: cells.slice(11).join('\t'),
  };
}

function median(values: readonly number[]): number {
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
