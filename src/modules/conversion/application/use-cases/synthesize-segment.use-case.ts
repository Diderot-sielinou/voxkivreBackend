import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';

import { CLOCK, type ClockPort } from '@/shared/kernel';
import { OBJECT_STORAGE, type ObjectStoragePort } from '@/shared/storage/object-storage.port';

import { type ConversionSegment } from '../../domain/entities/conversion-segment.entity';
import { TtsRequestRejectedError } from '../../domain/errors/tts.errors';
import { CONVERSION_JOBS, type ConversionJobsPort } from '../../domain/ports/conversion-jobs.port';
import {
  CONVERSION_REPOSITORY,
  type ConversionRepositoryPort,
} from '../../domain/ports/conversion-repository.port';
import { type SynthesisMark, TTS_ENGINE, type TtsPort } from '../../domain/ports/tts.port';
import { cacheKeysFor } from '../../domain/services/segment-fingerprint';
import { type ConversionId } from '../../domain/value-objects/conversion-id.vo';
import {
  ConversionFailureReason,
  ConversionStatus,
} from '../../domain/value-objects/conversion-status.vo';
import { type VoiceId } from '../../domain/voices';

import { FailConversionUseCase } from './fail-conversion.use-case';

export type SynthesisOutcome =
  | {
      readonly kind: 'synthesized';
      readonly cacheHit: boolean;
      readonly conversionCompleted: boolean;
    }
  | { readonly kind: 'rejected' }
  | { readonly kind: 'skipped' };

const MP3 = 'audio/mpeg';
const JSON_TYPE = 'application/json';

/** Contenu du `.json` en cache, à côté du `.mp3` (relu, donc validé). */
const cachedMarks = z.object({
  durationMs: z.number().int().nonnegative(),
  marks: z.array(z.object({ name: z.string(), timeSeconds: z.number().nonnegative() })),
});

type CachedMarks = z.infer<typeof cachedMarks>;

/**
 * Tâche `synthesize-segment` (worker) : un segment SSML → MP3 + horodatage
 * de chaque mot (RF-08, DEC-02).
 *
 * **Jamais deux paiements pour le même segment** (RNF-12) :
 * - segment déjà synthétisé → rien à faire ;
 * - cache par empreinte (RNF-26) : un segment identique déjà synthétisé —
 *   par cette conversion avant un crash, ou par n'importe quelle autre — est
 *   réutilisé sans appel au moteur ;
 * - clés de stockage déterministes : une relance réécrit, ne duplique pas.
 *
 * Le moteur est appelé hors transaction. Une requête refusée (définitif)
 * fait échouer la conversion avec remboursement ; une panne est levée (la
 * file réessaie).
 */
@Injectable()
export class SynthesizeSegmentUseCase {
  constructor(
    @Inject(CONVERSION_REPOSITORY) private readonly conversions: ConversionRepositoryPort,
    @Inject(TTS_ENGINE) private readonly tts: TtsPort,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort,
    @Inject(CONVERSION_JOBS) private readonly jobs: ConversionJobsPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    private readonly failConversion: FailConversionUseCase,
  ) {}

  async execute(id: ConversionId, index: number): Promise<SynthesisOutcome> {
    const conversion = await this.conversions.findById(id);
    // Conversion échouée ou terminée : on ne dépense plus rien pour elle.
    if (conversion?.status !== ConversionStatus.SYNTHESIZING) return { kind: 'skipped' };
    const segment = await this.conversions.findSegment(id, index);
    if (segment === null) return { kind: 'skipped' };
    if (segment.audio !== null) {
      // Crash entre l'écriture du segment et la suite : la relance termine.
      await this.afterSegment(segment);
      return { kind: 'skipped' };
    }

    const keys = cacheKeysFor(segment.fingerprint);
    let marks = await this.readCache(keys);
    const cacheHit = marks !== null;
    if (marks === null) {
      try {
        marks = await this.synthesize(segment, conversion.voiceId, keys);
      } catch (error) {
        if (!(error instanceof TtsRequestRejectedError)) throw error;
        await this.failConversion.execute(id, ConversionFailureReason.TTS_REJECTED);
        return { kind: 'rejected' };
      }
    }

    const now = this.clock.now();
    await this.conversions.completeSegment(
      id,
      index,
      {
        audioKey: keys.audio,
        timepoints: alignTimepoints(segment, marks.marks),
        durationMs: marks.durationMs,
        cacheHit,
      },
      now,
    );
    const conversionCompleted = await this.afterSegment(segment);
    return { kind: 'synthesized', cacheHit, conversionCompleted };
  }

  /**
   * Partie complète → assemblage programmé (ADR-0011) ; dernier segment →
   * `synthesized`. Renvoie `true` si c'est cet appel qui a clôturé la synthèse.
   */
  private async afterSegment(segment: ConversionSegment): Promise<boolean> {
    const id = segment.conversionId;
    if (await this.conversions.isPartSynthesized(id, segment.partIndex)) {
      await this.jobs.scheduleAssembly(id, segment.partIndex);
    }
    return this.conversions.completeIfAllSegmentsSynthesized(id, this.clock.now());
  }

  /** Marques en cache si le `.json` ET le `.mp3` existent (le `.json` est écrit en dernier). */
  private async readCache(keys: { audio: string; marks: string }): Promise<CachedMarks | null> {
    const raw = await this.storage.get(keys.marks);
    if (raw === null) return null;
    const parsed = cachedMarks.safeParse(parseJson(new TextDecoder().decode(raw)));
    if (!parsed.success) return null; // entrée corrompue : on resynthétise et on l'écrase
    return (await this.storage.head(keys.audio)) === null ? null : parsed.data;
  }

  private async synthesize(
    segment: ConversionSegment,
    voiceId: VoiceId,
    keys: { audio: string; marks: string },
  ): Promise<CachedMarks> {
    const result = await this.tts.synthesize({ ssml: segment.ssml, voiceId });
    const marks: CachedMarks = { durationMs: result.durationMs, marks: [...result.marks] };
    await this.storage.put(keys.audio, result.audio, MP3);
    await this.storage.put(keys.marks, new TextEncoder().encode(JSON.stringify(marks)), JSON_TYPE);
    return marks;
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Début de chaque mot (secondes), dans l'ordre de `words` ; `null` pour une marque absente. */
export function alignTimepoints(
  segment: Pick<ConversionSegment, 'words'>,
  marks: readonly SynthesisMark[],
): (number | null)[] {
  const byName = new Map(marks.map((mark) => [mark.name, mark.timeSeconds]));
  return segment.words.map((_, i) => byName.get(`w${String(i)}`) ?? null);
}
