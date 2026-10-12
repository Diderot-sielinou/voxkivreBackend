import { type ExtractedLine, type LineSegment } from './text-cleaning';

/**
 * Ordre de lecture et tableaux (RF-03, RF-05, ADR-0025), à partir des
 * segments horizontaux des lignes. L'ordre du PDF est le bon pour les
 * générateurs courants : on n'y touche que sur preuve.
 */

/** Au-delà, un segment est du texte courant, pas une cellule. */
export const MAX_CELL_LENGTH = 25;
/** Lignes tabulaires consécutives pour faire un tableau. */
export const MIN_TABLE_ROWS = 3;
/** Une ligne au moins du tableau a ce nombre de cellules. */
export const MIN_TABLE_COLUMNS = 3;
/** Colonnes alignées (gauche, centre ou droite) pour faire un tableau. */
export const MIN_ALIGNED_COLUMNS = 2;
/** Une colonne est alignée si elle se retrouve dans cette part des lignes. */
export const ALIGNED_ROWS_RATIO = 0.6;
/** Tolérance d'alignement, en largeur de page. */
export const ALIGN_TOLERANCE = 0.015;

/** La gouttière est cherchée dans le tiers central de la page. */
const GUTTER_ZONE: readonly [number, number] = [1 / 3, 2 / 3];
/** Largeur minimale de la gouttière, en largeur de page. */
export const MIN_GUTTER_WIDTH = 0.015;
/** Une bande est vide si au plus cette part des lignes la couvre. */
const GUTTER_MAX_COVERAGE = 0.1;
/** Lignes en travers (des deux côtés de la gouttière) : au moins 3, et 30 %. */
export const MIN_CROSSING_LINES = 3;
export const MIN_CROSSING_RATIO = 0.3;
/** Sous ce nombre de lignes géométriques, pas d'analyse de colonnes. */
const MIN_LINES_FOR_COLUMNS = 6;
const BINS = 200;

function isTabular(line: ExtractedLine): boolean {
  const segments = line.segments ?? [];
  if (segments.length < 2) return false;
  const length = segments.reduce((sum, segment) => sum + segment.text.length, 0);
  return length / segments.length <= MAX_CELL_LENGTH;
}

/**
 * Lignes de tableau d'une page : au moins 3 lignes tabulaires consécutives
 * (≥ 2 cellules courtes), dont une à 3 cellules, avec au moins 2 colonnes
 * alignées par le bord gauche, le centre ou le bord droit sur 60 % des
 * lignes (une cellule centrée ne commence pas au même endroit).
 */
export function findTableLines(lines: readonly ExtractedLine[]): ReadonlySet<ExtractedLine> {
  const table = new Set<ExtractedLine>();
  let run: ExtractedLine[] = [];
  const close = (): void => {
    if (isTable(run)) for (const line of run) table.add(line);
    run = [];
  };
  for (const line of lines) {
    if (isTabular(line)) run.push(line);
    else close();
  }
  close();
  return table;
}

function isTable(rows: readonly ExtractedLine[]): boolean {
  if (rows.length < MIN_TABLE_ROWS) return false;
  // La ligne la plus riche sert de référence : ses cellules sont des colonnes distinctes.
  const reference = rows.reduce((widest, row) =>
    (row.segments ?? []).length > (widest.segments ?? []).length ? row : widest,
  );
  const cells = reference.segments ?? [];
  if (cells.length < MIN_TABLE_COLUMNS) return false;
  const aligned = cells.filter((cell) => {
    const rowsWithIt = rows.filter((row) =>
      (row.segments ?? []).some((other) => isAligned(cell, other)),
    ).length;
    return rowsWithIt >= rows.length * ALIGNED_ROWS_RATIO;
  });
  return aligned.length >= MIN_ALIGNED_COLUMNS;
}

/** Même bord gauche, même centre ou même bord droit (une cellule centrée ne commence pas au même endroit). */
function isAligned(a: LineSegment, b: LineSegment): boolean {
  const center = (segment: LineSegment): number => (segment.left + segment.right) / 2;
  return (
    Math.abs(a.left - b.left) <= ALIGN_TOLERANCE ||
    Math.abs(center(a) - center(b)) <= ALIGN_TOLERANCE ||
    Math.abs(a.right - b.right) <= ALIGN_TOLERANCE
  );
}

/** Texte d'une ligne de tableau mise de côté : ses cellules jointes par « | ». */
export function tableRowText(line: ExtractedLine): string {
  const segments = line.segments ?? [];
  return segments.length === 0 ? line.text : segments.map((segment) => segment.text).join(' | ');
}

/**
 * Filet des colonnes écrites en travers (ADR-0025 §3) : si des lignes ont
 * du texte des deux côtés d'une gouttière commune, chaque ligne est coupée
 * à la gouttière, et la colonne gauche est lue avant la droite. Une ligne
 * qui couvre la gouttière (titre), une ligne de tableau ou sans géométrie
 * vide d'abord les deux colonnes accumulées. Sinon, la page est rendue
 * telle quelle.
 */
export function restoreColumnOrder(
  lines: readonly ExtractedLine[],
  tableLines: ReadonlySet<ExtractedLine>,
): readonly ExtractedLine[] {
  const geometric = lines.filter(
    (line) => (line.segments ?? []).length > 0 && !tableLines.has(line),
  );
  if (geometric.length < MIN_LINES_FOR_COLUMNS) return lines;
  // La gouttière se lit sur les lignes à plusieurs segments : un titre
  // pleine largeur la couvre sans la remettre en cause.
  const gutter = findGutter(geometric.filter((line) => (line.segments ?? []).length >= 2));
  if (gutter === null) return lines;
  const crossing = geometric.filter((line) => sidesOf(line, gutter) === 'both').length;
  if (crossing < MIN_CROSSING_LINES || crossing < geometric.length * MIN_CROSSING_RATIO) {
    return lines;
  }

  const ordered: ExtractedLine[] = [];
  let left: ExtractedLine[] = [];
  let right: ExtractedLine[] = [];
  const flush = (): void => {
    ordered.push(...left, ...right);
    left = [];
    right = [];
  };
  for (const line of lines) {
    const segments = line.segments ?? [];
    if (segments.length === 0 || tableLines.has(line) || sidesOf(line, gutter) === 'over') {
      flush();
      ordered.push(line);
      continue;
    }
    const leftPart = segments.filter((segment) => segment.right <= gutter);
    const rightPart = segments.filter((segment) => segment.left >= gutter);
    if (leftPart.length > 0) left.push(lineOf(line, leftPart));
    if (rightPart.length > 0) right.push(lineOf(line, rightPart));
  }
  flush();
  return ordered;
}

/** Milieu de la plus large bande vide du tiers central, ou `null`. */
function findGutter(lines: readonly ExtractedLine[]): number | null {
  if (lines.length < MIN_CROSSING_LINES) return null;
  const coverage = Array.from({ length: BINS }, (_, bin) => {
    const x = (bin + 0.5) / BINS;
    return lines.filter((line) =>
      (line.segments ?? []).some((segment) => segment.left <= x && x <= segment.right),
    ).length;
  });
  const maxCovered = lines.length * GUTTER_MAX_COVERAGE;
  let best: { start: number; end: number } | null = null;
  let start: number | null = null;
  for (let bin = 0; bin <= BINS; bin += 1) {
    const x = (bin + 0.5) / BINS;
    const empty =
      bin < BINS && x >= GUTTER_ZONE[0] && x <= GUTTER_ZONE[1] && coverage[bin] <= maxCovered;
    if (empty && start === null) start = bin;
    if (!empty && start !== null) {
      if (best === null || bin - start > best.end - best.start) best = { start, end: bin };
      start = null;
    }
  }
  if (best === null || (best.end - best.start) / BINS < MIN_GUTTER_WIDTH) return null;
  return (best.start + best.end) / 2 / BINS;
}

/** Où la ligne se place par rapport à la gouttière. */
function sidesOf(line: ExtractedLine, gutter: number): 'left' | 'right' | 'both' | 'over' {
  const segments = line.segments ?? [];
  if (segments.some((segment) => segment.left < gutter && gutter < segment.right)) return 'over';
  const hasLeft = segments.some((segment) => segment.right <= gutter);
  const hasRight = segments.some((segment) => segment.left >= gutter);
  if (hasLeft && hasRight) return 'both';
  return hasLeft ? 'left' : 'right';
}

function lineOf(line: ExtractedLine, segments: readonly LineSegment[]): ExtractedLine {
  return {
    text: segments.map((segment) => segment.text).join(' '),
    top: line.top,
    fontSize: line.fontSize,
    segments,
  };
}
