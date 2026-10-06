import { ExtractionFailureReason } from '../value-objects/document-status.vo';

/**
 * En dessous de cette moyenne de caractères par page, le PDF est considéré
 * comme scanné (images sans couche texte) : une vraie page de cours en
 * contient 1 500 à 3 000, une page scannée 0 à quelques numéros de page.
 */
export const MIN_AVG_CHARS_PER_PAGE = 50;

/** Texte brut d'une page, ligne par ligne, tel que fourni par l'extracteur. */
export interface ExtractedPageLines {
  readonly lines: readonly string[];
}

export interface PreparedPage {
  readonly pageNumber: number;
  readonly text: string;
  readonly charCount: number;
}

// Mot coupé en fin de ligne : lettre + tiret, la ligne suivante commence par
// une minuscule (« cou- » / « pé » → « coupé »). Un tiret suivi d'une
// majuscule (« Jean- » / « Paul ») est gardé : nom composé probable.
const HYPHENATED_LINE_END = /(\p{L})-$/u;
const STARTS_WITH_LOWERCASE = /^\p{Ll}/u;

/**
 * Assemble les lignes d'une page en texte (premier niveau de RF-05) :
 * espaces normalisés, lignes vides retirées, mots coupés recomposés. Les
 * sauts de ligne sont conservés pour l'écran de validation ; la mise en
 * paragraphes pour la synthèse viendra avec le nettoyage complet.
 */
export function assemblePageText(lines: readonly string[]): string {
  const cleaned = lines
    .map((line) => line.replaceAll(/\s+/gu, ' ').trim())
    .filter((line) => line.length > 0);
  const out: string[] = [];
  for (const line of cleaned) {
    const previous = out.at(-1);
    if (
      previous !== undefined &&
      HYPHENATED_LINE_END.test(previous) &&
      STARTS_WITH_LOWERCASE.test(line)
    ) {
      // Recompose le mot sur la ligne précédente, garde le reste de la ligne.
      const [firstWord = '', ...rest] = line.split(' ');
      out[out.length - 1] = `${previous.slice(0, -1)}${firstWord}`;
      if (rest.length > 0) out.push(rest.join(' '));
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
}

/** Nombre de caractères facturables d'un texte (hors sauts de ligne). */
export function countChars(text: string): number {
  return text.replaceAll('\n', '').length;
}

export type PreparedText =
  | { readonly ok: true; readonly pages: readonly PreparedPage[]; readonly charCount: number }
  | { readonly ok: false; readonly reason: ExtractionFailureReason };

/** Prépare les pages extraites et décide si le document est exploitable. */
export function prepareExtractedText(pages: readonly ExtractedPageLines[]): PreparedText {
  if (pages.length === 0) return { ok: false, reason: ExtractionFailureReason.EMPTY };
  const prepared = pages.map((page, index) => {
    const text = assemblePageText(page.lines);
    return { pageNumber: index + 1, text, charCount: countChars(text) };
  });
  const charCount = prepared.reduce((sum, page) => sum + page.charCount, 0);
  if (charCount / prepared.length < MIN_AVG_CHARS_PER_PAGE) {
    return { ok: false, reason: ExtractionFailureReason.SCANNED };
  }
  return { ok: true, pages: prepared, charCount };
}
