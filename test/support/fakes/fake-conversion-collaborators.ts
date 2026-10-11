import { type ConversionJobsPort } from '@/modules/conversion/domain/ports/conversion-jobs.port';
import {
  type DocumentTextSourcePort,
  type SourcePage,
  type SourceText,
} from '@/modules/conversion/domain/ports/document-text-source.port';
import { type QuotaPort } from '@/modules/conversion/domain/ports/quota.port';
import { type SynthesisResult, type TtsPort } from '@/modules/conversion/domain/ports/tts.port';
import { type ConversionId } from '@/modules/conversion/domain/value-objects/conversion-id.vo';
import { type VoiceId } from '@/modules/conversion/domain/voices';
import { FakeTtsAdapter } from '@/modules/conversion/infrastructure/tts/fake-tts.adapter';
import { type DomainError, Result } from '@/shared/kernel';
import { QueueUnavailableError } from '@/shared/queue/queue.errors';

/** Enregistre les tâches programmées ; `available = false` simule une file en panne. */
export class FakeConversionJobs implements ConversionJobsPort {
  readonly preparations: ConversionId[] = [];
  readonly syntheses: { id: ConversionId; indexes: readonly number[] }[] = [];
  readonly assemblies: { id: ConversionId; partIndex: number; retryKey?: string }[] = [];
  available = true;

  schedulePreparation(id: ConversionId): Promise<boolean> {
    if (!this.available) return Promise.resolve(false);
    this.preparations.push(id);
    return Promise.resolve(true);
  }

  scheduleSynthesis(id: ConversionId, indexes: readonly number[]): Promise<void> {
    if (!this.available) return Promise.reject(new QueueUnavailableError('queue down'));
    this.syntheses.push({ id, indexes });
    return Promise.resolve();
  }

  scheduleAssembly(id: ConversionId, partIndex: number, retryKey?: string): Promise<void> {
    if (!this.available) return Promise.reject(new QueueUnavailableError('queue down'));
    this.assemblies.push(retryKey === undefined ? { id, partIndex } : { id, partIndex, retryKey });
    return Promise.resolve();
  }
}

/** Documents et pages du point de vue de la conversion. */
export class FakeDocumentTextSource implements DocumentTextSourcePort {
  readonly texts = new Map<string, SourceText>();
  readonly pages = new Map<string, SourcePage[]>();
  /** Appelé après chaque lecture des pages (simule une correction concurrente). */
  onReadPages: (() => void) | null = null;

  add(text: SourceText, pages: SourcePage[]): void {
    this.texts.set(text.documentId, text);
    this.pages.set(text.documentId, pages);
  }

  findForOwner(documentId: string, ownerId: string): Promise<SourceText | null> {
    const found = this.texts.get(documentId);
    return Promise.resolve(found?.ownerId === ownerId ? found : null);
  }

  findById(documentId: string): Promise<SourceText | null> {
    return Promise.resolve(this.texts.get(documentId) ?? null);
  }

  readPages(documentId: string): Promise<readonly SourcePage[]> {
    const pages = this.pages.get(documentId) ?? [];
    this.onReadPages?.();
    return Promise.resolve(pages);
  }
}

/** Quota scripté : accepte tout, ou renvoie `rejectWith`. */
export class FakeQuota implements QuotaPort {
  readonly reserved: {
    reservationId: string;
    userId: string;
    chars: number;
    voiceTier: 'standard' | 'natural';
  }[] = [];
  readonly refunds: { reservationId: string; chars: number }[] = [];
  rejectWith: DomainError | null = null;

  reserve(input: {
    readonly reservationId: string;
    readonly userId: string;
    readonly chars: number;
    readonly voiceTier: 'standard' | 'natural';
  }): Promise<Result<void, DomainError>> {
    if (this.rejectWith !== null) return Promise.resolve(Result.err(this.rejectWith));
    this.reserved.push({ ...input });
    return Promise.resolve(Result.ok());
  }

  refund(reservationId: string, chars: number): Promise<void> {
    this.refunds.push({ reservationId, chars });
    return Promise.resolve();
  }
}

/** Moteur factice qui compte ses appels et peut échouer sur commande. */
export class RecordingTts implements TtsPort {
  readonly calls: { ssml: string; voiceId: VoiceId }[] = [];
  failWith: Error | null = null;
  private readonly engine = new FakeTtsAdapter();

  engineSignature(voiceId: VoiceId): string {
    return this.engine.engineSignature(voiceId);
  }

  synthesize(input: {
    readonly ssml: string;
    readonly voiceId: VoiceId;
  }): Promise<SynthesisResult> {
    this.calls.push({ ...input });
    if (this.failWith !== null) return Promise.reject(this.failWith);
    return this.engine.synthesize(input);
  }
}
