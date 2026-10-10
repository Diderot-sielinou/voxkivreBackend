import { type ReadingPosition } from '../entities/reading-position.entity';
import {
  ConversionState,
  DocumentState,
  LibraryItemStatus,
} from '../value-objects/library-item-status.vo';

/** Moins de 2 % des mots restants : le livre est terminé (ADR-0015 §4). */
export const FINISHED_REMAINING_RATIO = 0.02;

interface ConversionProgress {
  readonly state: ConversionState;
  readonly playableWordCount: number;
}

/**
 * Progression en pourcentage (0–100), seulement quand la conversion est
 * complète : avant, le nombre total de mots n'est pas connu.
 */
export function progressPercent(
  position: Pick<ReadingPosition, 'wordIndex'> | null,
  conversion: ConversionProgress | null,
): number | null {
  if (position === null || conversion?.state !== ConversionState.READY) return null;
  if (conversion.playableWordCount === 0) return null;
  const read = Math.min(position.wordIndex + 1, conversion.playableWordCount);
  return Math.floor((read / conversion.playableWordCount) * 100);
}

function isFinished(
  position: Pick<ReadingPosition, 'wordIndex'>,
  conversion: ConversionProgress,
): boolean {
  if (conversion.state !== ConversionState.READY || conversion.playableWordCount === 0) {
    return false;
  }
  const remaining = conversion.playableWordCount - (position.wordIndex + 1);
  return remaining / conversion.playableWordCount < FINISHED_REMAINING_RATIO;
}

/** Statut d'un livre (RF-17) : document, conversion retenue, position. */
export function deriveLibraryStatus(
  documentState: DocumentState,
  conversion: ConversionProgress | null,
  position: Pick<ReadingPosition, 'wordIndex'> | null,
): LibraryItemStatus {
  if (documentState === DocumentState.PROCESSING) return LibraryItemStatus.PROCESSING;
  if (documentState === DocumentState.FAILED) return LibraryItemStatus.FAILED;
  if (conversion === null) return LibraryItemStatus.NOT_CONVERTED;
  // Une lecture commencée prime : on peut écouter le début pendant la synthèse.
  if (position !== null) {
    return isFinished(position, conversion)
      ? LibraryItemStatus.FINISHED
      : LibraryItemStatus.IN_PROGRESS;
  }
  if (conversion.state === ConversionState.FAILED) return LibraryItemStatus.FAILED;
  if (conversion.state === ConversionState.READY) return LibraryItemStatus.READY;
  return LibraryItemStatus.PROCESSING;
}
