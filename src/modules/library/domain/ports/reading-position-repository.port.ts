import { type ReadingPosition } from '../entities/reading-position.entity';

export const READING_POSITION_REPOSITORY = Symbol('ReadingPositionRepository');

export interface SavedReadingPosition {
  /** La position retenue : celle envoyée, ou une plus récente déjà enregistrée. */
  readonly position: ReadingPosition;
  /** `false` si une position plus récente (ou identique) existait déjà. */
  readonly applied: boolean;
}

export interface ReadingPositionRepositoryPort {
  /**
   * « Le plus récent gagne » (ADR-0015) en une instruction : n'écrit que si
   * aucune position n'existe ou si la sienne est plus ancienne
   * (`recordedAt`).
   */
  saveIfNewer(position: ReadingPosition): Promise<SavedReadingPosition>;

  /** Filtré par propriétaire (RNF-08) ; `null` si aucune. */
  findForOwner(conversionId: string, ownerId: string): Promise<ReadingPosition | null>;

  /** Positions de ces conversions du propriétaire : une requête pour une page. */
  findForConversions(
    ownerId: string,
    conversionIds: readonly string[],
  ): Promise<readonly ReadingPosition[]>;
}
