import { ExtractionFailureReason } from '../value-objects/document-status.vo';

import { cleanPages, type ExtractedLine, type SetAsideLine } from './text-cleaning';

/**
 * En dessous de cette moyenne de caractères par page, le PDF est considéré
 * comme scanné (images sans couche texte) : une vraie page de cours en
 * contient 1 500 à 3 000, une page scannée 0 à quelques numéros de page.
 */
export const MIN_AVG_CHARS_PER_PAGE = 50;

/** Une page telle que fournie par l'extracteur : ses lignes, dans l'ordre. */
export interface ExtractedPageLines {
  readonly lines: readonly ExtractedLine[];
}

export interface PreparedPage {
  readonly pageNumber: number;
  /** Texte nettoyé (ADR-0022) : c'est lui qui sera lu et facturé. */
  readonly text: string;
  readonly charCount: number;
  /** Lignes mises de côté par le nettoyage, avec leur motif. */
  readonly setAside: readonly SetAsideLine[];
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

/**
 * Prépare les pages extraites et décide si le document est exploitable. Un
 * scan se juge sur le texte **brut** : un document très nettoyé n'est pas un
 * scan. Le texte gardé (et facturé) est le texte nettoyé (ADR-0022).
 */
export function prepareExtractedText(pages: readonly ExtractedPageLines[]): PreparedText {
  if (pages.length === 0) return { ok: false, reason: ExtractionFailureReason.EMPTY };
  const rawChars = pages.reduce(
    (sum, page) => sum + countChars(assemblePageText(page.lines.map((line) => line.text))),
    0,
  );
  if (rawChars / pages.length < MIN_AVG_CHARS_PER_PAGE) {
    return { ok: false, reason: ExtractionFailureReason.SCANNED };
  }
  const prepared = cleanPages(pages.map((page) => page.lines)).map((page, index) => {
    const text = assemblePageText(page.kept.map((line) => line.text));
    return { pageNumber: index + 1, text, charCount: countChars(text), setAside: page.setAside };
  });
  const charCount = prepared.reduce((sum, page) => sum + page.charCount, 0);
  return { ok: true, pages: prepared, charCount };
}
