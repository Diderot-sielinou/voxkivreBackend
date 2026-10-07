import { type AssembledPart, type ConversionPart } from '../entities/conversion-part.entity';
import {
  type ConversionSegment,
  type PreparedSegment,
  type SegmentAudio,
} from '../entities/conversion-segment.entity';
import { type Conversion } from '../entities/conversion.entity';
import { type PlannedPart } from '../services/part-plan';
import { type ConversionId } from '../value-objects/conversion-id.vo';
import {
  type ConversionFailureReason,
  type ConversionStatus,
} from '../value-objects/conversion-status.vo';
import { type VoiceId } from '../voices';

export const CONVERSION_REPOSITORY = Symbol('ConversionRepository');

/** Caractères réservés au lancement et caractères des segments déjà synthétisés. */
export interface FailedConversionCharge {
  readonly reservedChars: number;
  readonly consumedChars: number;
}

export interface StalledConversion {
  readonly id: ConversionId;
  readonly status: ConversionStatus;
}

/**
 * Persistance des conversions et de leurs segments. `tx` : transaction
 * ambiante transmise par le use-case (`UnitOfWork`), opaque ici.
 */
export interface ConversionRepositoryPort {
  /**
   * Insère une conversion `queued`. Lève `ConversionConflictError` si une
   * conversion active existe déjà pour (document, voix, révision).
   */
  insert(conversion: Conversion, tx?: unknown): Promise<void>;

  /** Conversion non échouée pour (document, voix, révision), ou `null`. */
  findActive(
    documentId: string,
    voiceId: VoiceId,
    textRevision: number,
  ): Promise<Conversion | null>;

  /** Filtre TOUJOURS sur le propriétaire (RNF-08). */
  findByIdForOwner(id: ConversionId, ownerId: string): Promise<Conversion | null>;

  /** Sans filtre propriétaire : réservé aux workers. */
  findById(id: ConversionId): Promise<Conversion | null>;

  /** `queued`/`preparing` → `preparing`. `false` si le statut ne le permet plus. */
  markPreparing(id: ConversionId, at: Date): Promise<boolean>;

  /**
   * **Atomique** : écrit tous les segments, le plan des parties ET passe en
   * `synthesizing`, seulement si la conversion est `preparing`. `false`
   * sinon (rien d'écrit).
   */
  completePreparation(
    id: ConversionId,
    segments: readonly PreparedSegment[],
    parts: readonly PlannedPart[],
    at: Date,
  ): Promise<boolean>;

  findSegment(id: ConversionId, index: number): Promise<ConversionSegment | null>;

  /** Index des segments sans audio, dans l'ordre. */
  listPendingSegmentIndexes(id: ConversionId): Promise<readonly number[]>;

  countSynthesizedSegments(id: ConversionId): Promise<number>;

  /**
   * Enregistre l'audio d'un segment **une seule fois** (`false` s'il en
   * avait déjà un) et rafraîchit `updatedAt` de la conversion.
   */
  completeSegment(id: ConversionId, index: number, audio: SegmentAudio, at: Date): Promise<boolean>;

  /** `synthesizing` → `synthesized` si plus aucun segment n'attend. `true` si c'est cet appel qui l'a fait. */
  completeIfAllSegmentsSynthesized(id: ConversionId, at: Date): Promise<boolean>;

  /**
   * Statut en cours → `failed` avec la raison, et renvoie de quoi rembourser.
   * `null` si la conversion est déjà terminée (succès ou échec).
   */
  markFailed(
    id: ConversionId,
    reason: ConversionFailureReason,
    at: Date,
    tx?: unknown,
  ): Promise<FailedConversionCharge | null>;

  // --- Parties (ADR-0011) -------------------------------------------------

  /** Parties dans l'ordre, assemblées ou non. */
  listParts(id: ConversionId): Promise<readonly ConversionPart[]>;

  findPart(id: ConversionId, partIndex: number): Promise<ConversionPart | null>;

  /** Segments d'une partie, dans l'ordre. */
  listPartSegments(id: ConversionId, partIndex: number): Promise<readonly ConversionSegment[]>;

  /** `true` si tous les segments de la partie sont synthétisés. */
  isPartSynthesized(id: ConversionId, partIndex: number): Promise<boolean>;

  /** Parties non assemblées dont tous les segments sont synthétisés (rattrapage). */
  listAssemblablePartIndexes(id: ConversionId): Promise<readonly number[]>;

  countAssembledParts(id: ConversionId): Promise<number>;

  /** Enregistre l'assemblage d'une partie **une seule fois** (`false` si déjà fait). */
  completePart(
    id: ConversionId,
    partIndex: number,
    assembled: AssembledPart,
    at: Date,
  ): Promise<boolean>;

  /**
   * `synthesized` → `ready` si toutes les parties sont assemblées. `true` si
   * c'est cet appel qui l'a fait.
   */
  markReadyIfAllPartsAssembled(id: ConversionId, at: Date): Promise<boolean>;

  /** Conversions dans `statuses` sans changement depuis `updatedBefore`. */
  findStalled(
    statuses: readonly ConversionStatus[],
    updatedBefore: Date,
    limit: number,
  ): Promise<readonly StalledConversion[]>;
}
