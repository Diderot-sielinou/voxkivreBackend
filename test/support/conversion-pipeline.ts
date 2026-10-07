import { AssemblePartUseCase } from '@/modules/conversion/application/use-cases/assemble-part.use-case';
import { FailConversionUseCase } from '@/modules/conversion/application/use-cases/fail-conversion.use-case';
import { PrepareConversionUseCase } from '@/modules/conversion/application/use-cases/prepare-conversion.use-case';
import { SynthesizeSegmentUseCase } from '@/modules/conversion/application/use-cases/synthesize-segment.use-case';
import { newQueuedConversion } from '@/modules/conversion/domain/entities/conversion.entity';
import { ConversionId } from '@/modules/conversion/domain/value-objects/conversion-id.vo';
import { type VoiceId } from '@/modules/conversion/domain/voices';
import { Mp3AudioAssembler } from '@/modules/conversion/infrastructure/tts/mp3-audio-assembler.adapter';

import {
  FakeConversionJobs,
  FakeDocumentTextSource,
  FakeObjectStorage,
  FakeQuota,
  FixedClock,
  ImmediateUnitOfWork,
  InMemoryConversionRepository,
  RecordingTts,
} from './fakes';

export const CONVERSION_ID = ConversionId.of('01a11019-f2e7-7014-8369-af25cb7e0f0c');
export const DOC = '01a11019-f2e7-7014-8369-af25cb7e0f0b';
export const NOW = new Date('2026-10-06T10:00:00Z');

/** Livre de `pages` pages d'environ 1 500 caractères (plusieurs segments). */
export function pagesOf(count: number) {
  return Array.from({ length: count }, (_, p) => ({
    pageNumber: p + 1,
    text: Array.from(
      { length: 30 },
      (_, s) => `Phrase ${String(s)} de la page ${String(p + 1)} sur le droit des sociétés.`,
    ).join('\n'),
  }));
}

/** Pipeline complet (préparation + synthèse) sur des fakes, conversion `queued` insérée. */
export async function pipeline(pageCount = 3) {
  const repo = new InMemoryConversionRepository();
  const documents = new FakeDocumentTextSource();
  documents.add(
    {
      documentId: DOC,
      ownerId: 'alice',
      textReady: true,
      status: 'text_ready',
      charCount: 5000,
      textRevision: 2,
    },
    pagesOf(pageCount),
  );
  const quota = new FakeQuota();
  const jobs = new FakeConversionJobs();
  const tts = new RecordingTts();
  const storage = new FakeObjectStorage();
  const clock = new FixedClock(NOW);
  const fail = new FailConversionUseCase(repo, quota, new ImmediateUnitOfWork(), clock);
  await repo.insert(
    newQueuedConversion({
      id: CONVERSION_ID,
      ownerId: 'alice',
      documentId: DOC,
      voiceId: 'fr-f1' as VoiceId,
      textRevision: 2,
      reservedChars: 5000,
      now: NOW,
    }),
  );
  return {
    repo,
    documents,
    quota,
    jobs,
    tts,
    storage,
    clock,
    prepare: new PrepareConversionUseCase(repo, documents, tts, jobs, clock, fail),
    synthesize: new SynthesizeSegmentUseCase(repo, tts, storage, jobs, clock, fail),
    assemble: new AssemblePartUseCase(repo, storage, new Mp3AudioAssembler(), clock),
  };
}
