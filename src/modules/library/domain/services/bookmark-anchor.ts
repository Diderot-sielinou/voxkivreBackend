import { type Bookmark, type ResolvedAnchor } from '../entities/bookmark.entity';

/** Mots de l'extrait gardé avec un marque-page. */
export const EXCERPT_WORDS = 6;
export const MAX_EXCERPT_LENGTH = 120;

/**
 * Mots d'une page, découpés comme la conversion découpe le texte (espaces) :
 * l'index d'un mot dans la page est le même ici et dans le manifeste
 * (`pageStarts`, ADR-0011).
 */
export function pageWords(text: string): string[] {
  return text.split(/\s+/u).filter((word) => word !== '');
}

/** Extrait à partir de l'ancrage : jusqu'à 6 mots, 120 caractères au plus. */
export function excerptAt(words: readonly string[], index: number): string {
  let excerpt = '';
  for (const word of words.slice(index, index + EXCERPT_WORDS)) {
    const next = excerpt === '' ? word : `${excerpt} ${word}`;
    if (next.length > MAX_EXCERPT_LENGTH) break;
    excerpt = next;
  }
  return excerpt === '' ? (words[index] ?? '').slice(0, MAX_EXCERPT_LENGTH) : excerpt;
}

const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

/** Comparaison tolérante : casse, accents et ponctuation de bord ignorés. */
function normalized(word: string): string {
  const bare = word.normalize('NFD').replaceAll(/\p{M}/gu, '').toLowerCase();
  let start = 0;
  let end = bare.length;
  while (start < end && !LETTER_OR_DIGIT.test(bare[start])) start += 1;
  while (end > start && !LETTER_OR_DIGIT.test(bare[end - 1])) end -= 1;
  return bare.slice(start, end);
}

function matchesAt(words: readonly string[], target: readonly string[], index: number): boolean {
  return target.every((word, offset) => normalized(words[index + offset] ?? '') === word);
}

/**
 * Retrouve l'ancrage dans le texte courant (ADR-0028 §4) : l'extrait à
 * l'index enregistré ; sinon, son occurrence la plus proche dans la page ;
 * sinon, le mot le plus proche de l'ancien index, marqué « à vérifier ».
 * Jamais d'échec : un marque-page n'est pas perdu pour un ancrage incertain.
 */
export function locateAnchor(
  words: readonly string[],
  anchor: { readonly wordIndex: number; readonly excerpt: string },
): ResolvedAnchor {
  const target = pageWords(anchor.excerpt).map((word) => normalized(word));
  if (words.length === 0) return { wordIndex: 0, needsReview: true };
  if (target.length > 0) {
    if (matchesAt(words, target, anchor.wordIndex)) {
      return { wordIndex: anchor.wordIndex, needsReview: false };
    }
    let best: number | null = null;
    for (let index = 0; index + target.length <= words.length; index += 1) {
      const closer =
        best === null || Math.abs(index - anchor.wordIndex) < Math.abs(best - anchor.wordIndex);
      if (closer && matchesAt(words, target, index)) best = index;
    }
    if (best !== null) return { wordIndex: best, needsReview: false };
  }
  return { wordIndex: Math.min(anchor.wordIndex, words.length - 1), needsReview: true };
}

/** Un marque-page tel que rendu : ancrage vérifié sur le texte courant (ADR-0028 §7). */
export interface BookmarkView {
  readonly id: string;
  readonly pageNumber: number;
  readonly wordIndex: number;
  readonly excerpt: string;
  readonly note: string;
  readonly needsReview: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  /** Trace de suppression retenue (réponse d'un `PUT` plus ancien qu'une suppression). */
  readonly deletedAt: Date | null;
}

/** Vue d'un marque-page sur le texte courant de sa page (`undefined` : page disparue). */
export function viewOf(bookmark: Bookmark, pageText: string | undefined): BookmarkView {
  const anchor = locateAnchor(pageWords(pageText ?? ''), bookmark);
  return {
    id: bookmark.id,
    pageNumber: bookmark.pageNumber,
    wordIndex: anchor.wordIndex,
    excerpt: bookmark.excerpt,
    note: bookmark.note,
    needsReview: anchor.needsReview,
    createdAt: bookmark.createdAt,
    updatedAt: bookmark.updatedAt,
    deletedAt: bookmark.deletedAt,
  };
}
