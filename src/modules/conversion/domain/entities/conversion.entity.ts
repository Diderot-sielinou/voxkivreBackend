import { type ConversionId } from '../value-objects/conversion-id.vo';
import {
  type ConversionFailureReason,
  ConversionStatus,
} from '../value-objects/conversion-status.vo';
import { type VoiceId } from '../voices';

/**
 * Conversion d'**une révision** du texte d'un document avec **une** voix
 * (SDD §7.1). `documentId` et `ownerId` viennent d'autres modules : de
 * simples chaînes, `conversion` ne dépend pas de leurs domaines.
 */
export interface Conversion {
  readonly id: ConversionId;
  readonly ownerId: string;
  readonly documentId: string;
  readonly voiceId: VoiceId;
  /** Révision du texte visée : une correction ultérieure ne la modifie pas. */
  readonly textRevision: number;
  readonly status: ConversionStatus;
  /** Caractères réservés sur le quota au lancement (ADR-0010). */
  readonly reservedChars: number;
  /** Renseignés à la fin de la préparation. */
  readonly segmentCount: number | null;
  readonly partCount: number | null;
  readonly failureReason: ConversionFailureReason | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly completedAt: Date | null;
}

export function newQueuedConversion(input: {
  readonly id: ConversionId;
  readonly ownerId: string;
  readonly documentId: string;
  readonly voiceId: VoiceId;
  readonly textRevision: number;
  readonly reservedChars: number;
  readonly now: Date;
}): Conversion {
  const { now, ...target } = input;
  return {
    ...target,
    status: ConversionStatus.QUEUED,
    segmentCount: null,
    partCount: null,
    failureReason: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  };
}
