import { type OcrPage } from '../services/ocr';

export const OCR = Symbol('Ocr');

/**
 * Reconnaissance du texte d'un PDF scanné, page par page (RF-04,
 * ADR-0024). Changer de moteur (Tesseract → Textract) = un nouvel adapter
 * (RNF-17).
 *
 * Contrat : `null` = PDF illisible pour le moteur (une propriété du
 * fichier, définitive). Toute autre erreur est levée (nouvel essai par la
 * file).
 */
export interface OcrPort {
  /** Pages `firstPage` à `lastPage` incluses (1-based), dans l'ordre. */
  recognizePages(
    pdf: Uint8Array,
    firstPage: number,
    lastPage: number,
  ): Promise<readonly OcrPage[] | null>;
}
