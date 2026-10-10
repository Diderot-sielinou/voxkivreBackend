import { type ConversionState } from '../value-objects/library-item-status.vo';

export const LIBRARY_CONVERSIONS = Symbol('LibraryConversions');

/** La conversion qui représente un livre, vue de la bibliothèque (module `conversion`). */
export interface LibraryConversion {
  readonly conversionId: string;
  readonly documentId: string;
  readonly voiceId: string;
  /** Statut brut du module conversion, renvoyé tel quel au mobile. */
  readonly status: string;
  readonly state: ConversionState;
  readonly failureReason: string | null;
  readonly partCount: number | null;
  readonly partsReady: number;
  /** Écoutable depuis le début : nombre de mots et durée. */
  readonly playableWordCount: number;
  readonly playableDurationMs: number;
  readonly completedAt: Date | null;
}

export interface DocumentConversionsCleanup {
  /** Une conversion travaille encore : suppression refusée (ADR-0016). */
  readonly running: boolean;
  readonly fileKeys: readonly string[];
}

/** Accès aux conversions, implémenté par un adapter vers `ConversionModule`. */
export interface LibraryConversionsPort {
  /** Conversion retenue de chaque document (ADR-0015 §5) ; absente si aucune. */
  forDocuments(
    ownerId: string,
    documentIds: readonly string[],
  ): Promise<ReadonlyMap<string, LibraryConversion>>;

  /** Filtré par propriétaire : `null` si absente ou à quelqu'un d'autre (RNF-08). */
  findForOwner(conversionId: string, ownerId: string): Promise<LibraryConversion | null>;

  /** Conversions d'un document avant sa suppression, lues dans la transaction `tx`. */
  cleanupForDocument(documentId: string, tx: unknown): Promise<DocumentConversionsCleanup>;
}
