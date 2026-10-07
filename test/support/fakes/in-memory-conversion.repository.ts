import {
  type AssembledPart,
  type ConversionPart,
} from '@/modules/conversion/domain/entities/conversion-part.entity';
import {
  type ConversionSegment,
  type PreparedSegment,
  type SegmentAudio,
} from '@/modules/conversion/domain/entities/conversion-segment.entity';
import { type Conversion } from '@/modules/conversion/domain/entities/conversion.entity';
import { ConversionConflictError } from '@/modules/conversion/domain/errors/conversion-conflict.error';
import {
  type ConversionRepositoryPort,
  type FailedConversionCharge,
  type StalledConversion,
} from '@/modules/conversion/domain/ports/conversion-repository.port';
import { type PlannedPart } from '@/modules/conversion/domain/services/part-plan';
import { type ConversionId } from '@/modules/conversion/domain/value-objects/conversion-id.vo';
import {
  type ConversionFailureReason,
  ConversionStatus,
  IN_PROGRESS_STATUSES,
} from '@/modules/conversion/domain/value-objects/conversion-status.vo';
import { type VoiceId } from '@/modules/conversion/domain/voices';

/** Fake du `ConversionRepositoryPort` : mêmes règles que l'adapter Drizzle, en mémoire. */
export class InMemoryConversionRepository implements ConversionRepositoryPort {
  readonly rows = new Map<string, Conversion>();
  readonly segments = new Map<string, ConversionSegment[]>();
  readonly parts = new Map<string, ConversionPart[]>();

  insert(conversion: Conversion): Promise<void> {
    const active = [...this.rows.values()].some(
      (c) =>
        c.documentId === conversion.documentId &&
        c.voiceId === conversion.voiceId &&
        c.textRevision === conversion.textRevision &&
        c.status !== ConversionStatus.FAILED,
    );
    if (active) return Promise.reject(new ConversionConflictError('active conversion exists'));
    this.rows.set(conversion.id, conversion);
    return Promise.resolve();
  }

  findActive(
    documentId: string,
    voiceId: VoiceId,
    textRevision: number,
  ): Promise<Conversion | null> {
    const found = [...this.rows.values()].find(
      (c) =>
        c.documentId === documentId &&
        c.voiceId === voiceId &&
        c.textRevision === textRevision &&
        c.status !== ConversionStatus.FAILED,
    );
    return Promise.resolve(found ?? null);
  }

  findByIdForOwner(id: ConversionId, ownerId: string): Promise<Conversion | null> {
    const found = this.rows.get(id);
    return Promise.resolve(found?.ownerId === ownerId ? found : null);
  }

  findById(id: ConversionId): Promise<Conversion | null> {
    return Promise.resolve(this.rows.get(id) ?? null);
  }

  markPreparing(id: ConversionId, at: Date): Promise<boolean> {
    return Promise.resolve(
      this.patchIf(id, [ConversionStatus.QUEUED, ConversionStatus.PREPARING], {
        status: ConversionStatus.PREPARING,
        updatedAt: at,
      }),
    );
  }

  completePreparation(
    id: ConversionId,
    segments: readonly PreparedSegment[],
    parts: readonly PlannedPart[],
    at: Date,
  ): Promise<boolean> {
    const done = this.patchIf(id, [ConversionStatus.PREPARING], {
      status: ConversionStatus.SYNTHESIZING,
      segmentCount: segments.length,
      partCount: parts.length,
      updatedAt: at,
    });
    if (done) {
      this.segments.set(
        id,
        segments.map((s) => ({ ...s, conversionId: id, audio: null })),
      );
      this.parts.set(
        id,
        parts.map((part) => ({
          conversionId: id,
          index: part.index,
          firstSegment: part.firstSegment,
          lastSegment: part.lastSegment,
          firstWordIndex: segments.find((s) => s.index === part.firstSegment)?.firstWordIndex ?? 0,
          assembled: null,
        })),
      );
    }
    return Promise.resolve(done);
  }

  listParts(id: ConversionId): Promise<readonly ConversionPart[]> {
    return Promise.resolve([...(this.parts.get(id) ?? [])]);
  }

  findPart(id: ConversionId, partIndex: number): Promise<ConversionPart | null> {
    return Promise.resolve(this.parts.get(id)?.find((p) => p.index === partIndex) ?? null);
  }

  listPartSegments(id: ConversionId, partIndex: number): Promise<readonly ConversionSegment[]> {
    return Promise.resolve((this.segments.get(id) ?? []).filter((s) => s.partIndex === partIndex));
  }

  isPartSynthesized(id: ConversionId, partIndex: number): Promise<boolean> {
    return Promise.resolve(
      (this.segments.get(id) ?? []).every((s) => s.partIndex !== partIndex || s.audio !== null),
    );
  }

  listAssemblablePartIndexes(id: ConversionId): Promise<readonly number[]> {
    const segments = this.segments.get(id) ?? [];
    return Promise.resolve(
      (this.parts.get(id) ?? [])
        .filter(
          (p) =>
            p.assembled === null &&
            segments.every((s) => s.partIndex !== p.index || s.audio !== null),
        )
        .map((p) => p.index),
    );
  }

  countAssembledParts(id: ConversionId): Promise<number> {
    return Promise.resolve((this.parts.get(id) ?? []).filter((p) => p.assembled !== null).length);
  }

  completePart(
    id: ConversionId,
    partIndex: number,
    assembled: AssembledPart,
    at: Date,
  ): Promise<boolean> {
    const list = this.parts.get(id) ?? [];
    const position = list.findIndex((p) => p.index === partIndex);
    if (position === -1 || list[position].assembled !== null) return Promise.resolve(false);
    list[position] = { ...list[position], assembled };
    const conversion = this.rows.get(id);
    if (conversion !== undefined) this.rows.set(id, { ...conversion, updatedAt: at });
    return Promise.resolve(true);
  }

  markReadyIfAllPartsAssembled(id: ConversionId, at: Date): Promise<boolean> {
    if ((this.parts.get(id) ?? []).some((p) => p.assembled === null)) return Promise.resolve(false);
    return Promise.resolve(
      this.patchIf(id, [ConversionStatus.SYNTHESIZED], {
        status: ConversionStatus.READY,
        updatedAt: at,
        completedAt: at,
      }),
    );
  }

  findSegment(id: ConversionId, index: number): Promise<ConversionSegment | null> {
    return Promise.resolve(this.segments.get(id)?.find((s) => s.index === index) ?? null);
  }

  listPendingSegmentIndexes(id: ConversionId): Promise<readonly number[]> {
    return Promise.resolve(
      (this.segments.get(id) ?? []).filter((s) => s.audio === null).map((s) => s.index),
    );
  }

  countSynthesizedSegments(id: ConversionId): Promise<number> {
    return Promise.resolve((this.segments.get(id) ?? []).filter((s) => s.audio !== null).length);
  }

  completeSegment(
    id: ConversionId,
    index: number,
    audio: SegmentAudio,
    at: Date,
  ): Promise<boolean> {
    const list = this.segments.get(id) ?? [];
    const position = list.findIndex((s) => s.index === index);
    if (position === -1 || list[position].audio !== null) return Promise.resolve(false);
    list[position] = { ...list[position], audio };
    const conversion = this.rows.get(id);
    if (conversion !== undefined) this.rows.set(id, { ...conversion, updatedAt: at });
    return Promise.resolve(true);
  }

  completeIfAllSegmentsSynthesized(id: ConversionId, at: Date): Promise<boolean> {
    const pending = (this.segments.get(id) ?? []).some((s) => s.audio === null);
    if (pending) return Promise.resolve(false);
    return Promise.resolve(
      this.patchIf(id, [ConversionStatus.SYNTHESIZING], {
        status: ConversionStatus.SYNTHESIZED,
        updatedAt: at,
      }),
    );
  }

  markFailed(
    id: ConversionId,
    reason: ConversionFailureReason,
    at: Date,
  ): Promise<FailedConversionCharge | null> {
    const conversion = this.rows.get(id);
    if (
      !this.patchIf(id, IN_PROGRESS_STATUSES, {
        status: ConversionStatus.FAILED,
        failureReason: reason,
        updatedAt: at,
      }) ||
      conversion === undefined
    ) {
      return Promise.resolve(null);
    }
    const consumedChars = (this.segments.get(id) ?? [])
      .filter((s) => s.audio !== null)
      .reduce((sum, s) => sum + s.charCount, 0);
    return Promise.resolve({ reservedChars: conversion.reservedChars, consumedChars });
  }

  findStalled(
    statuses: readonly ConversionStatus[],
    updatedBefore: Date,
    limit: number,
  ): Promise<readonly StalledConversion[]> {
    return Promise.resolve(
      [...this.rows.values()]
        .filter((c) => statuses.includes(c.status) && c.updatedAt < updatedBefore)
        .slice(0, limit)
        .map((c) => ({ id: c.id, status: c.status })),
    );
  }

  private patchIf(
    id: ConversionId,
    allowed: readonly ConversionStatus[],
    patch: Partial<Conversion>,
  ): boolean {
    const found = this.rows.get(id);
    if (found === undefined || !allowed.includes(found.status)) return false;
    this.rows.set(id, { ...found, ...patch });
    return true;
  }
}
