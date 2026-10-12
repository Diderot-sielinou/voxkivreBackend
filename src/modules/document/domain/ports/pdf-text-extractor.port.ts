import { type ExtractedPageLines } from '../services/extracted-text';
import { type OutlineEntry } from '../services/outline';

export const PDF_TEXT_EXTRACTOR = Symbol('PdfTextExtractor');

/**
 * Extraction du texte natif d'un PDF, page par page (RF-03). Changer de
 * bibliothèque = un nouvel adapter (RNF-17).
 *
 * Contrat : `null` = PDF illisible (corrompu, protégé par mot de passe) —
 * une propriété du fichier, définitive. Toute autre erreur est levée
 * (nouvel essai par la file).
 */
/** Le texte natif d'un PDF et ses signets (lus maintenant : le PDF sera supprimé, ADR-0027). */
export interface ExtractedPdf {
  readonly pages: readonly ExtractedPageLines[];
  /** Signets mis à plat avec leur niveau ; vide si le PDF n'en a pas. */
  readonly bookmarks: readonly OutlineEntry[];
}

export interface PdfTextExtractorPort {
  extract(pdf: Uint8Array): Promise<ExtractedPdf | null>;
}
