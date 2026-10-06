import { type ExtractedPageLines } from '../services/extracted-text';

export const PDF_TEXT_EXTRACTOR = Symbol('PdfTextExtractor');

/**
 * Extraction du texte natif d'un PDF, page par page (RF-03). Changer de
 * bibliothèque = un nouvel adapter (RNF-17).
 *
 * Contrat : `null` = PDF illisible (corrompu, protégé par mot de passe) —
 * une propriété du fichier, définitive. Toute autre erreur est levée
 * (nouvel essai par la file).
 */
export interface PdfTextExtractorPort {
  extract(pdf: Uint8Array): Promise<readonly ExtractedPageLines[] | null>;
}
