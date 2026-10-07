import { Inject, Injectable } from '@nestjs/common';

import { CLOCK, type ClockPort } from '@/shared/kernel';

import { type Conversion } from '../../domain/entities/conversion.entity';
import { CONVERSION_JOBS, type ConversionJobsPort } from '../../domain/ports/conversion-jobs.port';
import {
  CONVERSION_REPOSITORY,
  type ConversionRepositoryPort,
} from '../../domain/ports/conversion-repository.port';
import {
  DOCUMENT_TEXT_SOURCE,
  type DocumentTextSourcePort,
  type SourceText,
} from '../../domain/ports/document-text-source.port';
import { TTS_ENGINE, type TtsPort } from '../../domain/ports/tts.port';
import { planParts } from '../../domain/services/part-plan';
import { segmentFingerprint } from '../../domain/services/segment-fingerprint';
import { buildSsmlSegments } from '../../domain/services/ssml-segmenter';
import { type ConversionId } from '../../domain/value-objects/conversion-id.vo';
import {
  ConversionFailureReason,
  ConversionStatus,
} from '../../domain/value-objects/conversion-status.vo';

import { FailConversionUseCase } from './fail-conversion.use-case';

export type PreparationOutcome =
  | { readonly kind: 'prepared'; readonly segmentCount: number }
  | { readonly kind: 'resumed'; readonly pendingSegments: number }
  | { readonly kind: 'failed'; readonly reason: ConversionFailureReason }
  | { readonly kind: 'skipped' };

/**
 * Tâche `prepare-conversion` (worker) : texte du document → segments SSML
 * (ADR-0008) → une tâche de synthèse par segment.
 *
 * **Idempotente** (RNF-12) : segments et passage en `synthesizing` écrits
 * dans une transaction ; une relance sur une conversion déjà préparée
 * reprogramme seulement les segments sans audio (`jobId` déterministe).
 *
 * Le texte visé est celui de la révision réservée au lancement : s'il a été
 * corrigé entre-temps, la conversion échoue (`text_changed`) et le quota est
 * entièrement remboursé (ADR-0010).
 */
@Injectable()
export class PrepareConversionUseCase {
  constructor(
    @Inject(CONVERSION_REPOSITORY) private readonly conversions: ConversionRepositoryPort,
    @Inject(DOCUMENT_TEXT_SOURCE) private readonly documents: DocumentTextSourcePort,
    @Inject(TTS_ENGINE) private readonly tts: TtsPort,
    @Inject(CONVERSION_JOBS) private readonly jobs: ConversionJobsPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    private readonly failConversion: FailConversionUseCase,
  ) {}

  async execute(id: ConversionId): Promise<PreparationOutcome> {
    const conversion = await this.conversions.findById(id);
    if (conversion === null) return { kind: 'skipped' };
    if (conversion.status === ConversionStatus.SYNTHESIZING) return this.resume(conversion);
    if (!(await this.conversions.markPreparing(id, this.clock.now()))) return { kind: 'skipped' };

    const before = await this.documents.findById(conversion.documentId);
    const unusable = this.unusableReason(conversion, before);
    if (unusable !== null) return this.fail(id, unusable);

    const pages = await this.documents.readPages(conversion.documentId);
    // Correction pendant la lecture des pages : on ne mélange pas deux révisions.
    const after = await this.documents.findById(conversion.documentId);
    const changed = this.unusableReason(conversion, after);
    if (changed !== null) return this.fail(id, changed);

    const signature = this.tts.engineSignature(conversion.voiceId);
    const ssmlSegments = buildSsmlSegments(pages);
    if (ssmlSegments.length === 0) return this.fail(id, ConversionFailureReason.EMPTY_TEXT);

    // Plan des parties (ADR-0011) et position de chaque segment dans le livre.
    const parts = planParts(ssmlSegments);
    const partOf = new Map(
      parts.flatMap((part) =>
        Array.from({ length: part.lastSegment - part.firstSegment + 1 }, (_, k) => [
          part.firstSegment + k,
          part.index,
        ]),
      ),
    );
    let firstWordIndex = 0;
    const segments = ssmlSegments.map((segment) => {
      const prepared = {
        ...segment,
        fingerprint: segmentFingerprint(signature, segment.ssml),
        partIndex: partOf.get(segment.index) ?? 0,
        firstWordIndex,
      };
      firstWordIndex += segment.words.length;
      return prepared;
    });

    await this.conversions.completePreparation(id, segments, parts, this.clock.now());
    await this.jobs.scheduleSynthesis(
      id,
      segments.map((segment) => segment.index),
    );
    return { kind: 'prepared', segmentCount: segments.length };
  }

  private unusableReason(
    conversion: Conversion,
    source: SourceText | null,
  ): ConversionFailureReason | null {
    if (source?.textReady !== true) return ConversionFailureReason.SOURCE_UNAVAILABLE;
    if (source.textRevision !== conversion.textRevision) {
      return ConversionFailureReason.TEXT_CHANGED;
    }
    return null;
  }

  private async resume(conversion: Conversion): Promise<PreparationOutcome> {
    const pending = await this.conversions.listPendingSegmentIndexes(conversion.id);
    if (pending.length > 0) await this.jobs.scheduleSynthesis(conversion.id, pending);
    return { kind: 'resumed', pendingSegments: pending.length };
  }

  private async fail(
    id: ConversionId,
    reason: ConversionFailureReason,
  ): Promise<PreparationOutcome> {
    await this.failConversion.execute(id, reason);
    return { kind: 'failed', reason };
  }
}
