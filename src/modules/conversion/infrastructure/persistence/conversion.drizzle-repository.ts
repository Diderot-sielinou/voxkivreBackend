import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, eq, inArray, isNotNull, isNull, lt, ne, sql } from 'drizzle-orm';

import { DRIZZLE_CLIENT, type DrizzleClient } from '@/shared/persistence';

import {
  type AssembledPart,
  type ConversionPart,
  type PageStart,
} from '../../domain/entities/conversion-part.entity';
import {
  type ConversionSegment,
  type PreparedSegment,
  type SegmentAudio,
  type SegmentWord,
} from '../../domain/entities/conversion-segment.entity';
import { type Conversion } from '../../domain/entities/conversion.entity';
import { ConversionConflictError } from '../../domain/errors/conversion-conflict.error';
import {
  type ConversionRepositoryPort,
  type FailedConversionCharge,
  type StalledConversion,
} from '../../domain/ports/conversion-repository.port';
import { type PlannedPart } from '../../domain/services/part-plan';
import { ConversionId } from '../../domain/value-objects/conversion-id.vo';
import {
  ConversionFailureReason,
  ConversionStatus,
  IN_PROGRESS_STATUSES,
} from '../../domain/value-objects/conversion-status.vo';
import { type VoiceId } from '../../domain/voices';

import { conversionParts, conversions, conversionSegments } from './schema/conversion.schema';

/** Colonnes explicites (jamais `SELECT *`, performance-rules.md). */
const CONVERSION_COLUMNS = {
  id: conversions.id,
  ownerId: conversions.ownerId,
  documentId: conversions.documentId,
  voiceId: conversions.voiceId,
  textRevision: conversions.textRevision,
  status: conversions.status,
  reservedChars: conversions.reservedChars,
  segmentCount: conversions.segmentCount,
  partCount: conversions.partCount,
  failureReason: conversions.failureReason,
  createdAt: conversions.createdAt,
  updatedAt: conversions.updatedAt,
  completedAt: conversions.completedAt,
};

const SEGMENT_COLUMNS = {
  conversionId: conversionSegments.conversionId,
  segmentIndex: conversionSegments.segmentIndex,
  ssml: conversionSegments.ssml,
  words: conversionSegments.words,
  charCount: conversionSegments.charCount,
  fingerprint: conversionSegments.fingerprint,
  partIndex: conversionSegments.partIndex,
  firstWordIndex: conversionSegments.firstWordIndex,
  audioKey: conversionSegments.audioKey,
  timepoints: conversionSegments.timepoints,
  durationMs: conversionSegments.durationMs,
  cacheHit: conversionSegments.cacheHit,
};

type ConversionRow = {
  [K in keyof typeof CONVERSION_COLUMNS]: (typeof conversions.$inferSelect)[K];
};
type SegmentRow = {
  [K in keyof typeof SEGMENT_COLUMNS]: (typeof conversionSegments.$inferSelect)[K];
};

const PART_COLUMNS = {
  conversionId: conversionParts.conversionId,
  partIndex: conversionParts.partIndex,
  firstSegment: conversionParts.firstSegment,
  lastSegment: conversionParts.lastSegment,
  firstWordIndex: conversionParts.firstWordIndex,
  audioKey: conversionParts.audioKey,
  audioBytes: conversionParts.audioBytes,
  audioSha256: conversionParts.audioSha256,
  vttKey: conversionParts.vttKey,
  vttBytes: conversionParts.vttBytes,
  vttSha256: conversionParts.vttSha256,
  durationMs: conversionParts.durationMs,
  wordCount: conversionParts.wordCount,
  pageStarts: conversionParts.pageStarts,
  assembledAt: conversionParts.assembledAt,
};

type PartRow = { [K in keyof typeof PART_COLUMNS]: (typeof conversionParts.$inferSelect)[K] };

/** Segments écrits par paquets : borne la taille d'une requête (SSML de ~5 Ko chacun). */
const SEGMENT_INSERT_CHUNK = 200;

/** SQLSTATE `unique_violation`. */
const UNIQUE_VIOLATION = '23505';

const STATUSES = new Set<string>(Object.values(ConversionStatus));
const FAILURE_REASONS = new Set<string>(Object.values(ConversionFailureReason));

/**
 * Reconstitue l'entité. Les `CHECK` gardent `status` : une valeur inconnue
 * est un bug de migration, signalé plutôt que masqué.
 */
function toConversion(row: ConversionRow): Conversion {
  if (!STATUSES.has(row.status)) throw new Error(`Unknown conversion status "${row.status}"`);
  const failureReason =
    row.failureReason !== null && FAILURE_REASONS.has(row.failureReason)
      ? (row.failureReason as ConversionFailureReason)
      : null;
  return {
    id: ConversionId.of(row.id),
    ownerId: row.ownerId,
    documentId: row.documentId,
    voiceId: row.voiceId as VoiceId,
    textRevision: row.textRevision,
    status: row.status as ConversionStatus,
    reservedChars: row.reservedChars,
    segmentCount: row.segmentCount,
    partCount: row.partCount,
    failureReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt,
  };
}

function toSegment(row: SegmentRow): ConversionSegment {
  // jsonb écrits par ce repository uniquement : la forme est connue.
  const audio: SegmentAudio | null =
    row.audioKey === null
      ? null
      : {
          audioKey: row.audioKey,
          timepoints: row.timepoints as (number | null)[],
          durationMs: row.durationMs ?? 0,
          cacheHit: row.cacheHit ?? false,
        };
  return {
    conversionId: ConversionId.of(row.conversionId),
    index: row.segmentIndex,
    ssml: row.ssml,
    words: row.words as SegmentWord[],
    charCount: row.charCount,
    fingerprint: row.fingerprint,
    partIndex: row.partIndex ?? 0,
    firstWordIndex: row.firstWordIndex ?? 0,
    audio,
  };
}

function toPart(row: PartRow): ConversionPart {
  // Colonnes de fichiers écrites ensemble par `completePart` : toutes nulles ou toutes renseignées.
  const assembled: AssembledPart | null =
    row.assembledAt === null || row.audioKey === null || row.vttKey === null
      ? null
      : {
          audio: { key: row.audioKey, bytes: row.audioBytes ?? 0, sha256: row.audioSha256 ?? '' },
          vtt: { key: row.vttKey, bytes: row.vttBytes ?? 0, sha256: row.vttSha256 ?? '' },
          durationMs: row.durationMs ?? 0,
          wordCount: row.wordCount ?? 0,
          pageStarts: (row.pageStarts ?? []) as PageStart[],
        };
  return {
    conversionId: ConversionId.of(row.conversionId),
    index: row.partIndex,
    firstSegment: row.firstSegment,
    lastSegment: row.lastSegment,
    firstWordIndex: row.firstWordIndex,
    assembled,
  };
}

/** `true` si l'erreur (ou sa cause : Drizzle enveloppe l'erreur du driver) est une violation d'unicité. */
function isUniqueViolation(error: unknown): boolean {
  for (let current: unknown = error; current instanceof Error; current = current.cause) {
    if ((current as Error & { code?: unknown }).code === UNIQUE_VIOLATION) return true;
  }
  return false;
}

@Injectable()
export class DrizzleConversionRepository implements ConversionRepositoryPort {
  constructor(@Inject(DRIZZLE_CLIENT) private readonly db: DrizzleClient) {}

  async insert(conversion: Conversion, tx?: unknown): Promise<void> {
    try {
      await this.client(tx).insert(conversions).values({
        id: conversion.id,
        ownerId: conversion.ownerId,
        documentId: conversion.documentId,
        voiceId: conversion.voiceId,
        textRevision: conversion.textRevision,
        status: conversion.status,
        reservedChars: conversion.reservedChars,
        segmentCount: conversion.segmentCount,
        partCount: conversion.partCount,
        failureReason: conversion.failureReason,
        createdAt: conversion.createdAt,
        updatedAt: conversion.updatedAt,
        completedAt: conversion.completedAt,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConversionConflictError('An active conversion already exists for this target', {
          cause: error,
        });
      }
      throw error;
    }
  }

  async findActive(
    documentId: string,
    voiceId: VoiceId,
    textRevision: number,
  ): Promise<Conversion | null> {
    // Même prédicat que l'index unique partiel `conversions_active_target_idx`.
    const rows = await this.db
      .select(CONVERSION_COLUMNS)
      .from(conversions)
      .where(
        and(
          eq(conversions.documentId, documentId),
          eq(conversions.voiceId, voiceId),
          eq(conversions.textRevision, textRevision),
          ne(conversions.status, ConversionStatus.FAILED),
        ),
      )
      .limit(1);
    const row = rows.at(0);
    return row === undefined ? null : toConversion(row);
  }

  async findByIdForOwner(id: ConversionId, ownerId: string): Promise<Conversion | null> {
    const rows = await this.db
      .select(CONVERSION_COLUMNS)
      .from(conversions)
      .where(and(eq(conversions.id, id), eq(conversions.ownerId, ownerId)))
      .limit(1);
    const row = rows.at(0);
    return row === undefined ? null : toConversion(row);
  }

  async findById(id: ConversionId): Promise<Conversion | null> {
    const rows = await this.db
      .select(CONVERSION_COLUMNS)
      .from(conversions)
      .where(eq(conversions.id, id))
      .limit(1);
    const row = rows.at(0);
    return row === undefined ? null : toConversion(row);
  }

  async markPreparing(id: ConversionId, at: Date): Promise<boolean> {
    const updated = await this.db
      .update(conversions)
      .set({ status: ConversionStatus.PREPARING, updatedAt: at })
      .where(
        and(
          eq(conversions.id, id),
          inArray(conversions.status, [ConversionStatus.QUEUED, ConversionStatus.PREPARING]),
        ),
      )
      .returning({ id: conversions.id });
    return updated.length > 0;
  }

  async completePreparation(
    id: ConversionId,
    segments: readonly PreparedSegment[],
    parts: readonly PlannedPart[],
    at: Date,
  ): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      // Le statut d'abord : il verrouille la ligne ; une exécution concurrente
      // arrivée en second ne trouve plus `preparing` et n'écrit rien.
      const updated = await tx
        .update(conversions)
        .set({
          status: ConversionStatus.SYNTHESIZING,
          segmentCount: segments.length,
          partCount: parts.length,
          updatedAt: at,
        })
        .where(and(eq(conversions.id, id), eq(conversions.status, ConversionStatus.PREPARING)))
        .returning({ id: conversions.id });
      if (updated.length === 0) return false;

      for (let i = 0; i < segments.length; i += SEGMENT_INSERT_CHUNK) {
        await tx.insert(conversionSegments).values(
          segments.slice(i, i + SEGMENT_INSERT_CHUNK).map((segment) => ({
            conversionId: id,
            segmentIndex: segment.index,
            ssml: segment.ssml,
            words: segment.words,
            charCount: segment.charCount,
            fingerprint: segment.fingerprint,
            partIndex: segment.partIndex,
            firstWordIndex: segment.firstWordIndex,
          })),
        );
      }
      const firstWordOf = new Map(
        segments.map((segment) => [segment.index, segment.firstWordIndex]),
      );
      if (parts.length > 0) {
        await tx.insert(conversionParts).values(
          parts.map((part) => ({
            conversionId: id,
            partIndex: part.index,
            firstSegment: part.firstSegment,
            lastSegment: part.lastSegment,
            firstWordIndex: firstWordOf.get(part.firstSegment) ?? 0,
          })),
        );
      }
      return true;
    });
  }

  async findSegment(id: ConversionId, index: number): Promise<ConversionSegment | null> {
    const rows = await this.db
      .select(SEGMENT_COLUMNS)
      .from(conversionSegments)
      .where(
        and(eq(conversionSegments.conversionId, id), eq(conversionSegments.segmentIndex, index)),
      )
      .limit(1);
    const row = rows.at(0);
    return row === undefined ? null : toSegment(row);
  }

  async listPendingSegmentIndexes(id: ConversionId): Promise<readonly number[]> {
    const rows = await this.db
      .select({ index: conversionSegments.segmentIndex })
      .from(conversionSegments)
      .where(and(eq(conversionSegments.conversionId, id), isNull(conversionSegments.audioKey)))
      .orderBy(asc(conversionSegments.segmentIndex));
    return rows.map((row) => row.index);
  }

  async countSynthesizedSegments(id: ConversionId): Promise<number> {
    const rows = await this.db
      .select({ done: count() })
      .from(conversionSegments)
      .where(and(eq(conversionSegments.conversionId, id), isNotNull(conversionSegments.audioKey)));
    return rows.at(0)?.done ?? 0;
  }

  async completeSegment(
    id: ConversionId,
    index: number,
    audio: SegmentAudio,
    at: Date,
  ): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const updated = await tx
        .update(conversionSegments)
        .set({
          audioKey: audio.audioKey,
          timepoints: audio.timepoints,
          durationMs: audio.durationMs,
          cacheHit: audio.cacheHit,
          synthesizedAt: at,
        })
        .where(
          and(
            eq(conversionSegments.conversionId, id),
            eq(conversionSegments.segmentIndex, index),
            isNull(conversionSegments.audioKey),
          ),
        )
        .returning({ index: conversionSegments.segmentIndex });
      if (updated.length === 0) return false;
      // Activité récente : le balayage ne reprogramme pas une conversion qui avance.
      await tx.update(conversions).set({ updatedAt: at }).where(eq(conversions.id, id));
      return true;
    });
  }

  async completeIfAllSegmentsSynthesized(id: ConversionId, at: Date): Promise<boolean> {
    const updated = await this.db
      .update(conversions)
      .set({ status: ConversionStatus.SYNTHESIZED, updatedAt: at })
      .where(
        and(
          eq(conversions.id, id),
          eq(conversions.status, ConversionStatus.SYNTHESIZING),
          sql`not exists (select 1 from ${conversionSegments} where ${conversionSegments.conversionId} = ${id} and ${conversionSegments.audioKey} is null)`,
        ),
      )
      .returning({ id: conversions.id });
    return updated.length > 0;
  }

  async markFailed(
    id: ConversionId,
    reason: ConversionFailureReason,
    at: Date,
    tx?: unknown,
  ): Promise<FailedConversionCharge | null> {
    const db = this.client(tx);
    const failed = await db
      .update(conversions)
      .set({ status: ConversionStatus.FAILED, failureReason: reason, updatedAt: at })
      .where(and(eq(conversions.id, id), inArray(conversions.status, IN_PROGRESS_STATUSES)))
      .returning({ reservedChars: conversions.reservedChars });
    const row = failed.at(0);
    if (row === undefined) return null;
    const consumed = await db
      .select({ chars: sql<number>`coalesce(sum(${conversionSegments.charCount}), 0)::int` })
      .from(conversionSegments)
      .where(and(eq(conversionSegments.conversionId, id), isNotNull(conversionSegments.audioKey)));
    return { reservedChars: row.reservedChars, consumedChars: consumed.at(0)?.chars ?? 0 };
  }

  async listParts(id: ConversionId): Promise<readonly ConversionPart[]> {
    const rows = await this.db
      .select(PART_COLUMNS)
      .from(conversionParts)
      .where(eq(conversionParts.conversionId, id))
      .orderBy(asc(conversionParts.partIndex));
    return rows.map((row) => toPart(row));
  }

  async findPart(id: ConversionId, partIndex: number): Promise<ConversionPart | null> {
    const rows = await this.db
      .select(PART_COLUMNS)
      .from(conversionParts)
      .where(and(eq(conversionParts.conversionId, id), eq(conversionParts.partIndex, partIndex)))
      .limit(1);
    const row = rows.at(0);
    return row === undefined ? null : toPart(row);
  }

  async listPartSegments(
    id: ConversionId,
    partIndex: number,
  ): Promise<readonly ConversionSegment[]> {
    const rows = await this.db
      .select(SEGMENT_COLUMNS)
      .from(conversionSegments)
      .where(
        and(eq(conversionSegments.conversionId, id), eq(conversionSegments.partIndex, partIndex)),
      )
      .orderBy(asc(conversionSegments.segmentIndex));
    return rows.map((row) => toSegment(row));
  }

  async isPartSynthesized(id: ConversionId, partIndex: number): Promise<boolean> {
    const rows = await this.db
      .select({ pending: count() })
      .from(conversionSegments)
      .where(
        and(
          eq(conversionSegments.conversionId, id),
          eq(conversionSegments.partIndex, partIndex),
          isNull(conversionSegments.audioKey),
        ),
      );
    return (rows.at(0)?.pending ?? 0) === 0;
  }

  async listAssemblablePartIndexes(id: ConversionId): Promise<readonly number[]> {
    const rows = await this.db
      .select({ index: conversionParts.partIndex })
      .from(conversionParts)
      .where(
        and(
          eq(conversionParts.conversionId, id),
          isNull(conversionParts.assembledAt),
          sql`not exists (select 1 from ${conversionSegments} where ${conversionSegments.conversionId} = ${id} and ${conversionSegments.partIndex} = ${conversionParts.partIndex} and ${conversionSegments.audioKey} is null)`,
        ),
      )
      .orderBy(asc(conversionParts.partIndex));
    return rows.map((row) => row.index);
  }

  async countAssembledParts(id: ConversionId): Promise<number> {
    const rows = await this.db
      .select({ done: count() })
      .from(conversionParts)
      .where(and(eq(conversionParts.conversionId, id), isNotNull(conversionParts.assembledAt)));
    return rows.at(0)?.done ?? 0;
  }

  async completePart(
    id: ConversionId,
    partIndex: number,
    assembled: AssembledPart,
    at: Date,
  ): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const updated = await tx
        .update(conversionParts)
        .set({
          audioKey: assembled.audio.key,
          audioBytes: assembled.audio.bytes,
          audioSha256: assembled.audio.sha256,
          vttKey: assembled.vtt.key,
          vttBytes: assembled.vtt.bytes,
          vttSha256: assembled.vtt.sha256,
          durationMs: assembled.durationMs,
          wordCount: assembled.wordCount,
          pageStarts: assembled.pageStarts,
          assembledAt: at,
        })
        .where(
          and(
            eq(conversionParts.conversionId, id),
            eq(conversionParts.partIndex, partIndex),
            isNull(conversionParts.assembledAt),
          ),
        )
        .returning({ index: conversionParts.partIndex });
      if (updated.length === 0) return false;
      // Activité récente : le balayage ne relance pas une conversion qui avance.
      await tx.update(conversions).set({ updatedAt: at }).where(eq(conversions.id, id));
      return true;
    });
  }

  async markReadyIfAllPartsAssembled(id: ConversionId, at: Date): Promise<boolean> {
    const updated = await this.db
      .update(conversions)
      .set({ status: ConversionStatus.READY, updatedAt: at, completedAt: at })
      .where(
        and(
          eq(conversions.id, id),
          eq(conversions.status, ConversionStatus.SYNTHESIZED),
          sql`not exists (select 1 from ${conversionParts} where ${conversionParts.conversionId} = ${id} and ${conversionParts.assembledAt} is null)`,
        ),
      )
      .returning({ id: conversions.id });
    return updated.length > 0;
  }

  async findStalled(
    statuses: readonly ConversionStatus[],
    updatedBefore: Date,
    limit: number,
  ): Promise<readonly StalledConversion[]> {
    const rows = await this.db
      .select({ id: conversions.id, status: conversions.status })
      .from(conversions)
      .where(
        and(inArray(conversions.status, [...statuses]), lt(conversions.updatedAt, updatedBefore)),
      )
      .orderBy(asc(conversions.updatedAt))
      .limit(limit);
    return rows.map((row) => ({
      id: ConversionId.of(row.id),
      status: row.status as ConversionStatus,
    }));
  }

  /**
   * Transaction ambiante (fournie par le `UnitOfWork`) ou connexion par
   * défaut. Invariant : le `TxContext` opaque est toujours une transaction
   * Drizzle, qui expose la même API de requêtes que le client.
   */
  private client(tx?: unknown): DrizzleClient {
    return (tx as DrizzleClient | undefined) ?? this.db;
  }
}
