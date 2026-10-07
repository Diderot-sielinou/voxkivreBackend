import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { CLOCK, type ClockPort } from '@/shared/kernel';
import { OBJECT_STORAGE, type ObjectStoragePort } from '@/shared/storage/object-storage.port';

import {
  type AssembledPart,
  type DeliveredFile,
  type PageStart,
} from '../../domain/entities/conversion-part.entity';
import { type Conversion } from '../../domain/entities/conversion.entity';
import { AUDIO_ASSEMBLER, type AudioAssemblerPort } from '../../domain/ports/audio-assembler.port';
import {
  CONVERSION_REPOSITORY,
  type ConversionRepositoryPort,
} from '../../domain/ports/conversion-repository.port';
import { manifestKey, partFileKeys } from '../../domain/services/conversion-files';
import { buildManifest } from '../../domain/services/conversion-manifest';
import { buildPartTimeline, type TimedWord } from '../../domain/services/part-timeline';
import { buildWebVtt } from '../../domain/services/webvtt';
import { type ConversionId } from '../../domain/value-objects/conversion-id.vo';
import { ConversionStatus } from '../../domain/value-objects/conversion-status.vo';

export type AssemblyOutcome =
  | { readonly kind: 'assembled'; readonly durationMs: number; readonly conversionReady: boolean }
  | { readonly kind: 'skipped'; readonly reason: string };

const MP3 = 'audio/mpeg';
const VTT = 'text/vtt';
const JSON_TYPE = 'application/json';

/** Statuts où une partie peut être assemblée : la synthèse avance ou est finie. */
const ASSEMBLABLE_STATUSES: ReadonlySet<ConversionStatus> = new Set([
  ConversionStatus.SYNTHESIZING,
  ConversionStatus.SYNTHESIZED,
]);

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Pages qui commencent dans la partie : premier mot de chaque page. */
function pageStartsOf(words: readonly TimedWord[], previousPage: number | null): PageStart[] {
  const starts: PageStart[] = [];
  let current = previousPage;
  for (const word of words) {
    if (word.page !== current) {
      starts.push({ page: word.page, wordIndex: word.index });
      current = word.page;
    }
  }
  return starts;
}

/**
 * Tâche `assemble-part` (worker) : les segments d'une partie → un MP3 (trames
 * concaténées, sans réencodage) + un WebVTT au mot (ADR-0011). La dernière
 * partie écrit le manifeste et passe la conversion en `ready`.
 *
 * **Idempotente** : clés de fichiers déterministes (une relance réécrit),
 * partie marquée assemblée une seule fois, manifeste réécrit à l'identique.
 * Une panne est levée (la file réessaie) ; elle ne fait jamais échouer la
 * conversion, déjà payée — le balayage relance.
 */
@Injectable()
export class AssemblePartUseCase {
  constructor(
    @Inject(CONVERSION_REPOSITORY) private readonly conversions: ConversionRepositoryPort,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort,
    @Inject(AUDIO_ASSEMBLER) private readonly assembler: AudioAssemblerPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
  ) {}

  async execute(id: ConversionId, partIndex: number): Promise<AssemblyOutcome> {
    const conversion = await this.conversions.findById(id);
    if (conversion === null || !ASSEMBLABLE_STATUSES.has(conversion.status)) {
      return { kind: 'skipped', reason: 'conversion_not_assemblable' };
    }
    const part = await this.conversions.findPart(id, partIndex);
    if (part === null) return { kind: 'skipped', reason: 'unknown_part' };

    let durationMs = part.assembled?.durationMs ?? 0;
    if (part.assembled === null) {
      const assembled = await this.assemble(conversion, partIndex);
      if (assembled === null) return { kind: 'skipped', reason: 'segments_pending' };
      await this.conversions.completePart(id, partIndex, assembled, this.clock.now());
      durationMs = assembled.durationMs;
    }
    return { kind: 'assembled', durationMs, conversionReady: await this.finalize(conversion) };
  }

  /** `null` si un segment de la partie n'a pas encore d'audio. */
  private async assemble(conversion: Conversion, partIndex: number): Promise<AssembledPart | null> {
    const segments = await this.conversions.listPartSegments(conversion.id, partIndex);
    const chunks: Uint8Array[] = [];
    for (const segment of segments) {
      if (segment.audio === null) return null;
      const bytes = await this.storage.get(segment.audio.audioKey);
      // Objet du cache disparu : panne de stockage à réessayer, pas une donnée à inventer.
      if (bytes === null) throw new Error(`Missing segment audio ${segment.audio.audioKey}`);
      chunks.push(bytes);
    }
    const { audio, durationsMs } = this.assembler.join(chunks);
    const words = buildPartTimeline(
      segments.map((segment, i) => ({
        firstWordIndex: segment.firstWordIndex,
        words: segment.words,
        timepoints: segment.audio?.timepoints ?? [],
        durationMs: durationsMs[i] ?? 0,
      })),
    );
    const vtt = new TextEncoder().encode(buildWebVtt(words));
    const keys = partFileKeys(conversion.ownerId, conversion.id, partIndex);
    await this.storage.put(keys.audio, audio, MP3);
    await this.storage.put(keys.vtt, vtt, VTT);

    const previousPage = await this.lastPageBefore(conversion.id, partIndex);
    const file = (key: string, bytes: Uint8Array): DeliveredFile => ({
      key,
      bytes: bytes.length,
      sha256: sha256(bytes),
    });
    return {
      audio: file(keys.audio, audio),
      vtt: file(keys.vtt, vtt),
      durationMs: durationsMs.reduce((sum, ms) => sum + ms, 0),
      wordCount: words.length,
      pageStarts: pageStartsOf(words, previousPage),
    };
  }

  /** Page du dernier mot de la partie précédente : une page à cheval ne « recommence » pas. */
  private async lastPageBefore(id: ConversionId, partIndex: number): Promise<number | null> {
    if (partIndex === 0) return null;
    const previous = await this.conversions.listPartSegments(id, partIndex - 1);
    return previous.at(-1)?.words.at(-1)?.p ?? null;
  }

  /** Toutes les parties assemblées → manifeste écrit, puis `ready`. */
  private async finalize(conversion: Conversion): Promise<boolean> {
    const fresh = await this.conversions.findById(conversion.id);
    if (fresh?.status !== ConversionStatus.SYNTHESIZED) return false;
    const parts = await this.conversions.listParts(conversion.id);
    if (parts.some((part) => part.assembled === null)) return false;
    const manifest = buildManifest(fresh, parts);
    await this.storage.put(
      manifestKey(fresh.ownerId, fresh.id),
      new TextEncoder().encode(JSON.stringify(manifest)),
      JSON_TYPE,
    );
    return this.conversions.markReadyIfAllPartsAssembled(fresh.id, this.clock.now());
  }
}
