import { type ConversionId } from '../value-objects/conversion-id.vo';

/** Un fichier livré au mobile : il vérifie sa taille et son empreinte (RF-17). */
export interface DeliveredFile {
  readonly key: string;
  readonly bytes: number;
  readonly sha256: string;
}

/** Première page qui commence dans la partie, et index global de son premier mot. */
export interface PageStart {
  readonly page: number;
  readonly wordIndex: number;
}

/** Résultat de l'assemblage d'une partie (ADR-0011). */
export interface AssembledPart {
  readonly audio: DeliveredFile;
  readonly vtt: DeliveredFile;
  readonly durationMs: number;
  readonly wordCount: number;
  readonly pageStarts: readonly PageStart[];
}

/** Partie d'environ 10 minutes : une suite de segments consécutifs. */
export interface ConversionPart {
  readonly conversionId: ConversionId;
  readonly index: number;
  readonly firstSegment: number;
  readonly lastSegment: number;
  readonly firstWordIndex: number;
  /** `null` tant que la partie n'est pas assemblée. */
  readonly assembled: AssembledPart | null;
}
