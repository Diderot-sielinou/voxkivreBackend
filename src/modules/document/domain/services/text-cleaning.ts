/**
 * Nettoyage du texte extrait (RF-05, ADR-0022) : numéros de page, en-têtes
 * et pieds répétés, notes de bas de page et légendes sont **mis de côté**
 * avec leur motif, jamais jetés (le PDF source est supprimé ensuite).
 *
 * Règles déterministes, page par page, à partir du texte de chaque ligne,
 * de sa position verticale et de sa taille de police quand l'extracteur les
 * connaît.
 */

/** Une ligne telle que fournie par l'extracteur (RF-03 ; OCR plus tard). */
export interface ExtractedLine {
  readonly text: string;
  /** Position verticale, de 0 (haut de la page) à 1 (bas) ; `null` si inconnue. */
  readonly top: number | null;
  /** Taille de police en points ; `null` si inconnue. */
  readonly fontSize: number | null;
}

export const SetAsideReason = {
  HEADER: 'header',
  FOOTER: 'footer',
  PAGE_NUMBER: 'page_number',
  FOOTNOTE: 'footnote',
  CAPTION: 'caption',
} as const;

export type SetAsideReason = (typeof SetAsideReason)[keyof typeof SetAsideReason];

export interface SetAsideLine {
  readonly text: string;
  readonly reason: SetAsideReason;
}

export interface CleanedPage {
  /** Lignes gardées, dans l'ordre : elles seront lues. */
  readonly kept: readonly ExtractedLine[];
  readonly setAside: readonly SetAsideLine[];
}

/** Part haute et basse de la page considérée comme marge (§2). */
export const MARGIN_RATIO = 0.1;
/** Sans position connue : nombre de lignes de marge en haut et en bas. */
export const MARGIN_LINES_WITHOUT_POSITION = 2;
/** Une page plus courte n'a pas de marge sans position (tout serait marge). */
export const MIN_LINES_FOR_POSITIONLESS_MARGIN = 6;
/** Répétition d'un en-tête : au moins 3 pages dans une fenêtre de 6 (§4). */
export const REPEAT_MIN_PAGES = 3;
export const REPEAT_WINDOW_PAGES = 6;
/** Une note est en police au moins 15 % plus petite que le corps (§5). */
export const FOOTNOTE_FONT_RATIO = 0.85;
/** Une note commence dans la moitié basse de la page. */
export const FOOTNOTE_MIN_TOP = 0.5;
/** Au-delà, une ligne n'est pas une légende ni un en-tête. */
export const MAX_SHORT_LINE_LENGTH = 200;
/** Garde-fou : une page n'est jamais vidée de plus de la moitié (§7). */
export const MAX_REMOVED_RATIO = 0.5;

type Zone = 'top' | 'bottom' | 'body';

// Numéro de page : `12`, `- 12 -`, `Page 12`, `p. 12`, `12/300`, `12 sur
// 300`, `xii`. Reconnu mot par mot, sans expression régulière complexe.
const PAGE_WORDS = new Set(['page', 'p.']);
const TOTAL_WORDS = new Set(['/', 'sur', 'of']);
const DASHES = new Set(['-', '–', '—']);
const ARABIC_NUMBER = /^\d{1,4}$/u;
const ROMAN_DIGITS = /^[ivxlcdm]{1,8}$/u;
const ROMAN_VALUES: readonly (readonly [string, number])[] = [
  ['m', 1000],
  ['cm', 900],
  ['d', 500],
  ['cd', 400],
  ['c', 100],
  ['xc', 90],
  ['l', 50],
  ['xl', 40],
  ['x', 10],
  ['ix', 9],
  ['v', 5],
  ['iv', 4],
  ['i', 1],
];
// Légende : `Figure 3 :`, `Fig. 2 –`, `Tableau 1.`, `Figure n° 5 :`, `Source :`.
const CAPTION_LABEL = /^(?:figure|fig\.|tableau|graphique|sch[ée]ma|photo|illustration)\s*/iu;
const CAPTION_NUMBER_PREFIX = /^n°\s*/iu;
const CAPTION_NUMBER = /^\d+[a-z]?\s*[:.\-–—]/iu;
const SOURCE_LINE = /^source\s*:/iu;
const FOOTNOTE_CALL = /^(?:\d{1,3}|[¹²³⁴⁵⁶⁷⁸⁹⁰]{1,3}|\*{1,3}|[†‡])(?=[\s.)\p{L}]|$)/u;

/**
 * Empreinte d'une ligne de marge : minuscules sans accents, chiffres → `#`,
 * ni ponctuation ni espaces. « Droit des obligations — 47 » et « … — 48 »
 * ont la même empreinte.
 */
export function fingerprint(text: string): string {
  return text
    .normalize('NFD')
    .replaceAll(/\p{M}/gu, '')
    .toLowerCase()
    .replaceAll(/\d+/gu, '#')
    .replaceAll(/[^\p{L}#]/gu, '');
}

export function isPageNumber(text: string): boolean {
  let words = text
    .toLowerCase()
    .replaceAll('/', ' / ')
    .split(/\s+/u)
    .map((word) => trimDashes(word))
    .filter((word) => word.length > 0);
  if (words.length > 0 && PAGE_WORDS.has(words[0])) words = words.slice(1);
  if (words.length === 3 && TOTAL_WORDS.has(words[1]) && ARABIC_NUMBER.test(words[2])) {
    words = words.slice(0, 1);
  }
  return words.length === 1 && (ARABIC_NUMBER.test(words[0]) || isRomanNumber(words[0]));
}

function trimDashes(word: string): string {
  let start = 0;
  let end = word.length;
  while (start < end && DASHES.has(word[start])) start += 1;
  while (end > start && DASHES.has(word[end - 1])) end -= 1;
  return word.slice(start, end);
}

/** Chiffre romain bien formé : sa réécriture canonique est identique. */
function isRomanNumber(word: string): boolean {
  if (!ROMAN_DIGITS.test(word)) return false;
  let value = 0;
  let rest = word;
  for (const [symbol, amount] of ROMAN_VALUES) {
    while (rest.startsWith(symbol)) {
      value += amount;
      rest = rest.slice(symbol.length);
    }
  }
  return rest === '' && value > 0 && toRoman(value) === word;
}

function toRoman(value: number): string {
  let out = '';
  let rest = value;
  for (const [symbol, amount] of ROMAN_VALUES) {
    while (rest >= amount) {
      out += symbol;
      rest -= amount;
    }
  }
  return out;
}

export function isCaption(text: string): boolean {
  const line = text.trim();
  if (line.length >= MAX_SHORT_LINE_LENGTH) return false;
  if (SOURCE_LINE.test(line)) return true;
  const label = CAPTION_LABEL.exec(line);
  if (label === null) return false;
  const afterLabel = line.slice(label[0].length).replace(CAPTION_NUMBER_PREFIX, '');
  return CAPTION_NUMBER.test(afterLabel);
}

/** Nettoie toutes les pages d'un document (la répétition se juge entre pages). */
export function cleanPages(pages: readonly (readonly ExtractedLine[])[]): CleanedPage[] {
  const normalized = pages.map((lines) =>
    lines
      .map((line) => ({ ...line, text: line.text.replaceAll(/\s+/gu, ' ').trim() }))
      .filter((line) => line.text.length > 0),
  );
  const zones = normalized.map((lines) => lines.map((line, i) => zoneOf(line, i, lines.length)));
  const repeated = repeatedMarginLines(normalized, zones);

  return normalized.map((lines, pageIndex) => {
    const reasons = classify(lines, zones[pageIndex], repeated[pageIndex]);
    return applyWithGuard(lines, reasons);
  });
}

function zoneOf(line: ExtractedLine, index: number, count: number): Zone {
  if (line.top !== null) {
    if (line.top <= MARGIN_RATIO) return 'top';
    if (line.top >= 1 - MARGIN_RATIO) return 'bottom';
    return 'body';
  }
  if (count < MIN_LINES_FOR_POSITIONLESS_MARGIN) return 'body';
  if (index < MARGIN_LINES_WITHOUT_POSITION) return 'top';
  if (index >= count - MARGIN_LINES_WITHOUT_POSITION) return 'bottom';
  return 'body';
}

/**
 * Pour chaque page, l'ensemble des lignes de marge (par index) dont
 * l'empreinte revient en marge, dans la même zone, sur au moins 3 pages
 * d'une fenêtre de 6 pages consécutives contenant la page.
 */
function repeatedMarginLines(
  pages: readonly (readonly ExtractedLine[])[],
  zones: readonly (readonly Zone[])[],
): Set<number>[] {
  const occurrences = new Map<string, number[]>();
  const keys = pages.map((lines, pageIndex) =>
    lines.map((line, i) => {
      const zone = zones[pageIndex][i];
      const print = fingerprint(line.text);
      if (zone === 'body' || print === '' || line.text.length >= MAX_SHORT_LINE_LENGTH) {
        return null;
      }
      const key = `${zone}:${print}`;
      const pagesWithKey = occurrences.get(key) ?? [];
      if (pagesWithKey.at(-1) !== pageIndex) pagesWithKey.push(pageIndex);
      occurrences.set(key, pagesWithKey);
      return key;
    }),
  );
  return keys.map((pageKeys, pageIndex) => {
    const lines = new Set<number>();
    for (const [i, key] of pageKeys.entries()) {
      if (key !== null && repeatsAround(occurrences.get(key) ?? [], pageIndex)) lines.add(i);
    }
    return lines;
  });
}

/** Une fenêtre de 6 pages contenant `page` compte-t-elle 3 occurrences ? */
function repeatsAround(sortedPages: readonly number[], page: number): boolean {
  for (let start = page - REPEAT_WINDOW_PAGES + 1; start <= page; start += 1) {
    const end = start + REPEAT_WINDOW_PAGES - 1;
    const inWindow = sortedPages.filter((p) => p >= start && p <= end).length;
    if (inWindow >= REPEAT_MIN_PAGES) return true;
  }
  return false;
}

function classify(
  lines: readonly ExtractedLine[],
  zones: readonly Zone[],
  repeated: ReadonlySet<number>,
): (SetAsideReason | null)[] {
  const reasons: (SetAsideReason | null)[] = lines.map((line, i) => {
    const zone = zones[i];
    if (zone !== 'body' && isPageNumber(line.text)) return SetAsideReason.PAGE_NUMBER;
    if (isCaption(line.text)) return SetAsideReason.CAPTION;
    if (repeated.has(i)) return zone === 'top' ? SetAsideReason.HEADER : SetAsideReason.FOOTER;
    return null;
  });
  markFootnotes(lines, reasons);
  return reasons;
}

/**
 * Bloc de notes : première ligne de la moitié basse, en petite police, qui
 * commence par un appel ; puis toutes les lignes suivantes en petite police.
 * Sans tailles de police connues, aucune note n'est détectée.
 */
function markFootnotes(lines: readonly ExtractedLine[], reasons: (SetAsideReason | null)[]): void {
  const body = bodyFontSize(lines, reasons);
  if (body === null) return;
  const isSmall = (line: ExtractedLine): boolean =>
    line.fontSize !== null && line.fontSize <= body * FOOTNOTE_FONT_RATIO;

  const start = lines.findIndex(
    (line, i) =>
      reasons[i] === null &&
      line.top !== null &&
      line.top >= FOOTNOTE_MIN_TOP &&
      isSmall(line) &&
      FOOTNOTE_CALL.test(line.text),
  );
  if (start === -1) return;
  for (let i = start; i < lines.length; i += 1) {
    if (reasons[i] !== null) continue;
    if (!isSmall(lines[i])) return;
    reasons[i] = SetAsideReason.FOOTNOTE;
  }
}

/** Taille médiane du corps, pondérée par le nombre de caractères. */
function bodyFontSize(
  lines: readonly ExtractedLine[],
  reasons: readonly (SetAsideReason | null)[],
): number | null {
  const sized = lines
    .filter((line, i) => reasons[i] === null && line.fontSize !== null)
    .map((line) => ({ size: line.fontSize ?? 0, weight: line.text.length }))
    .toSorted((a, b) => a.size - b.size);
  const total = sized.reduce((sum, entry) => sum + entry.weight, 0);
  if (total === 0) return null;
  let cumulated = 0;
  const median = sized.find((entry) => {
    cumulated += entry.weight;
    return cumulated * 2 >= total;
  });
  return median?.size ?? null;
}

/** Applique la classification, sauf si elle vide la page de plus de la moitié (§7). */
function applyWithGuard(
  lines: readonly ExtractedLine[],
  reasons: readonly (SetAsideReason | null)[],
): CleanedPage {
  const total = lines.reduce((sum, line) => sum + line.text.length, 0);
  const removed = lines.reduce(
    (sum, line, i) => (reasons[i] === null ? sum : sum + line.text.length),
    0,
  );
  if (total === 0 || removed > total * MAX_REMOVED_RATIO) return { kept: lines, setAside: [] };
  const kept: ExtractedLine[] = [];
  const setAside: SetAsideLine[] = [];
  for (const [i, line] of lines.entries()) {
    const reason = reasons[i];
    if (reason === null) kept.push(line);
    else setAside.push({ text: line.text, reason });
  }
  return { kept, setAside };
}
