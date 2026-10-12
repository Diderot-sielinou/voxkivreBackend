import { type ExtractedLine } from './text-cleaning';

/**
 * Table des matières (RF-12, ADR-0027) : signets du PDF, sinon titres
 * détectés par leur police. Une entrée désigne une page ; l'app y cherche
 * les mots du titre pour sauter au bon instant de l'audio.
 */
export interface OutlineEntry {
  readonly title: string;
  /** 1 = plus haut niveau ; 3 au plus. */
  readonly level: number;
  /** 1-based. */
  readonly pageNumber: number;
}

export type OutlineSource = 'bookmarks' | 'headings';

export interface Outline {
  readonly source: OutlineSource;
  readonly entries: readonly OutlineEntry[];
}

/** Un titre est au moins 8 % plus grand que le corps (11 pt / 10 pt sur un article). */
export const HEADING_FONT_RATIO = 1.08;
export const MAX_HEADING_LENGTH = 120;
/** Titre à la taille du corps, reconnu par son mot-clé : plus court. */
export const MAX_KEYWORD_HEADING_LENGTH = 80;
export const MAX_OUTLINE_LEVEL = 3;
/** Deux tailles de police à moins de cet écart sont la même taille. */
const SAME_SIZE_POINTS = 0.25;
const MIN_LETTERS = 3;

const KEYWORD_HEADING =
  /^(?:chapitre|titre|partie|section|le[çc]on|th[èe]me|introduction|conclusion)(?:\s|$|[\s:.–—-])/iu;
const LETTER = /\p{L}/gu;

/** Signets lus dans le PDF, déjà mis à plat avec leur niveau. */
export function outlineFromBookmarks(bookmarks: readonly OutlineEntry[]): readonly OutlineEntry[] {
  return bookmarks
    .filter((entry) => entry.level <= MAX_OUTLINE_LEVEL && entry.title.trim() !== '')
    .map((entry) => ({ ...entry, title: entry.title.replaceAll(/\s+/gu, ' ').trim() }));
}

/** Les signets s'ils existent, sinon les titres détectés dans les lignes gardées. */
export function buildOutline(
  bookmarks: readonly OutlineEntry[],
  keptPages: readonly (readonly ExtractedLine[])[],
): Outline {
  const fromBookmarks = outlineFromBookmarks(bookmarks);
  if (fromBookmarks.length > 0) return { source: 'bookmarks', entries: fromBookmarks };
  return { source: 'headings', entries: detectHeadings(keptPages) };
}

interface Candidate {
  readonly text: string;
  readonly size: number;
  readonly pageNumber: number;
}

/**
 * Titres d'un document à partir des lignes gardées par le nettoyage, page
 * par page (ADR-0027 §2–§4).
 */
export function detectHeadings(pages: readonly (readonly ExtractedLine[])[]): OutlineEntry[] {
  const body = documentBodySize(pages);
  if (body === null) return [];
  const candidates = mergeWrapped(
    pages.flatMap((lines, index) => candidatesOf(lines, index + 1, body)),
  );
  const sizes = distinctSizes(candidates.map((candidate) => candidate.size));
  return candidates.map((candidate) => ({
    title: candidate.text,
    level: Math.min(
      MAX_OUTLINE_LEVEL,
      1 + sizes.findIndex((size) => Math.abs(size - candidate.size) <= SAME_SIZE_POINTS),
    ),
    pageNumber: candidate.pageNumber,
  }));
}

/** Les candidats d'une page ; `null` entre deux candidats non consécutifs. */
function candidatesOf(
  lines: readonly ExtractedLine[],
  pageNumber: number,
  body: number,
): (Candidate | null)[] {
  return lines.map((line) => {
    const text = line.text.replaceAll(/\s+/gu, ' ').trim();
    const size = line.fontSize;
    if (line.vertical === true || size === null || text.length > MAX_HEADING_LENGTH) return null;
    if ((text.match(LETTER) ?? []).length < MIN_LETTERS) return null;
    if (size >= body * HEADING_FONT_RATIO) return { text, size, pageNumber };
    const atBodySize = Math.abs(size - body) <= SAME_SIZE_POINTS;
    if (atBodySize && text.length <= MAX_KEYWORD_HEADING_LENGTH && KEYWORD_HEADING.test(text)) {
      return { text, size, pageNumber };
    }
    return null;
  });
}

/** Lignes candidates consécutives de même taille, sur une même page : un titre sur deux lignes. */
function mergeWrapped(candidates: readonly (Candidate | null)[]): Candidate[] {
  const merged: Candidate[] = [];
  let previous: Candidate | null = null;
  for (const candidate of candidates) {
    if (candidate === null) {
      previous = null;
      continue;
    }
    const last = merged.at(-1);
    if (
      previous !== null &&
      last !== undefined &&
      previous.pageNumber === candidate.pageNumber &&
      Math.abs(previous.size - candidate.size) <= SAME_SIZE_POINTS &&
      `${last.text} ${candidate.text}`.length <= MAX_HEADING_LENGTH
    ) {
      merged[merged.length - 1] = { ...last, text: `${last.text} ${candidate.text}` };
    } else {
      merged.push(candidate);
    }
    previous = candidate;
  }
  return merged;
}

/** Tailles distinctes, de la plus grande à la plus petite. */
function distinctSizes(sizes: readonly number[]): number[] {
  const distinct: number[] = [];
  for (const size of sizes.toSorted((a, b) => b - a)) {
    const last = distinct.at(-1);
    if (last === undefined || last - size > SAME_SIZE_POINTS) distinct.push(size);
  }
  return distinct;
}

/** Taille du corps : médiane des tailles, pondérée par le nombre de caractères. */
function documentBodySize(pages: readonly (readonly ExtractedLine[])[]): number | null {
  const sized = pages
    .flat()
    .filter((line) => line.fontSize !== null && line.vertical !== true)
    .map((line) => ({ size: line.fontSize ?? 0, weight: line.text.length }))
    .toSorted((a, b) => a.size - b.size);
  const total = sized.reduce((sum, entry) => sum + entry.weight, 0);
  if (total === 0) return null;
  let cumulated = 0;
  return (
    sized.find((entry) => {
      cumulated += entry.weight;
      return cumulated * 2 >= total;
    })?.size ?? null
  );
}
