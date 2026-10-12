import { type ExtractedLine } from '../../domain/services/text-cleaning';

/** Hauteur d'une page A4 en points : `fontSize` est exprimé comme sur un PDF natif. */
const A4_HEIGHT_PT = 842;

/** Niveaux de la sortie TSV de Tesseract. */
const LEVEL_PAGE = 1;
const LEVEL_LINE = 4;
const LEVEL_WORD = 5;

/** Colonnes : level page_num block_num par_num line_num word_num left top width height conf text. */
const COLUMN_COUNT = 12;

interface TsvRow {
  readonly level: number;
  /** `bloc.paragraphe.ligne` : relie un mot à sa ligne. */
  readonly lineKey: string;
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

  const pageHeight = rows.find((row) => row.level === LEVEL_PAGE)?.height ?? 0;
  const words = rows.filter((row) => row.level === LEVEL_WORD && row.text.trim() !== '');
  const wordsByLine = new Map<string, TsvRow[]>();
  for (const word of words) {
    const group = wordsByLine.get(word.lineKey);
    if (group === undefined) wordsByLine.set(word.lineKey, [word]);
    else group.push(word);
  }

  const lines: ExtractedLine[] = [];
  for (const row of rows) {
    if (row.level !== LEVEL_LINE) continue;
    const lineWords = wordsByLine.get(row.lineKey);
    if (lineWords === undefined) continue;
    lines.push({
      text: lineWords.map((word) => word.text.trim()).join(' '),
      top: pageHeight > 0 ? clamp01(row.top / pageHeight) : null,
      fontSize:
        pageHeight > 0
          ? (median(lineWords.map((w) => w.height)) / pageHeight) * A4_HEIGHT_PT
          : null,
    });
  }

  const scored = words.filter((word) => word.conf >= 0);
  const confidence =
    scored.length === 0
      ? null
      : round3(scored.reduce((sum, word) => sum + word.conf, 0) / scored.length / 100);
  return { lines, confidence };
}

function toRow(line: string): TsvRow | null {
  const cells = line.split('\t');
  if (cells.length < COLUMN_COUNT) return null;
  const level = Number(cells[0]);
  const top = Number(cells[7]);
  const height = Number(cells[9]);
  const conf = Number(cells[10]);
  if (![level, top, height, conf].every((n) => Number.isFinite(n))) return null;
  return {
    level,
    lineKey: `${cells[2]}.${cells[3]}.${cells[4]}`,
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
