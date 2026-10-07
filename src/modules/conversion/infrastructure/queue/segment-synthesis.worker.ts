import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type Job, UnrecoverableError } from 'bullmq';
import { z } from 'zod';

import { type Env } from '@/shared/config';
import {
  createJobWorker,
  type JobHandler,
  type JobWorkerHandle,
} from '@/shared/queue/job-worker.factory';
import { buildRedisOptions } from '@/shared/redis';

import { FailConversionUseCase } from '../../application/use-cases/fail-conversion.use-case';
import { SynthesizeSegmentUseCase } from '../../application/use-cases/synthesize-segment.use-case';
import { ConversionId } from '../../domain/value-objects/conversion-id.vo';
import { ConversionFailureReason } from '../../domain/value-objects/conversion-status.vo';

import { CONVERSION_SYNTHESIS_QUEUE } from './conversion-jobs.constants';

/**
 * Synthèses simultanées : de l'attente réseau, pas du CPU — compatible avec
 * un seul processus (ADR-0009), et très loin du quota Google de 1 000
 * requêtes par minute.
 */
const SYNTHESIS_CONCURRENCY = 4;

const synthesizePayload = z.object({
  conversionId: z.uuid(),
  segmentIndex: z.number().int().nonnegative(),
});

/** Consommateur de `conversion-synthesis` : glue BullMQ ↔ use-cases, aucune règle métier. */
@Injectable()
export class SegmentSynthesisWorker
  implements JobHandler, OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(SegmentSynthesisWorker.name);
  private worker: JobWorkerHandle | null = null;

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly synthesize: SynthesizeSegmentUseCase,
    private readonly failConversion: FailConversionUseCase,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.get('JOB_WORKERS_ENABLED', { infer: true })) return;
    this.worker = createJobWorker(
      CONVERSION_SYNTHESIS_QUEUE,
      this,
      buildRedisOptions(this.config),
      SYNTHESIS_CONCURRENCY,
    );
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
  }

  async handle(job: Job): Promise<void> {
    const parsed = synthesizePayload.safeParse(job.data);
    if (!parsed.success) throw new UnrecoverableError('Invalid synthesize-segment payload');
    const { conversionId, segmentIndex } = parsed.data;
    const outcome = await this.synthesize.execute(ConversionId.of(conversionId), segmentIndex);
    this.logger.log({ jobId: job.id, conversionId, segmentIndex, outcome }, 'Synthesis outcome');
    // Log comptable (observability.md) ; `conversion.completed` est émis au passage en `ready`.
    if (outcome.kind === 'rejected') {
      this.logger.warn(
        { conversionId, step: 'synthesize', code: 'TTS_REQUEST_REJECTED' },
        'conversion.failed',
      );
    }
  }

  async onFinalFailure(job: Job, error: Error): Promise<void> {
    const parsed = synthesizePayload.safeParse(job.data);
    if (!parsed.success) return;
    // Un segment impossible à synthétiser fait échouer toute la conversion
    // (remboursement du reste) plutôt que de livrer un livre troué.
    const failed = await this.failConversion.execute(
      ConversionId.of(parsed.data.conversionId),
      ConversionFailureReason.INTERNAL,
    );
    if (failed) {
      this.logger.warn(
        { conversionId: parsed.data.conversionId, step: 'synthesize', code: error.name },
        'conversion.failed',
      );
    }
  }
}
