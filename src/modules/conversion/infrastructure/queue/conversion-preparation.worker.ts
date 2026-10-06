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
import { PrepareConversionUseCase } from '../../application/use-cases/prepare-conversion.use-case';
import { ConversionId } from '../../domain/value-objects/conversion-id.vo';
import { ConversionFailureReason } from '../../domain/value-objects/conversion-status.vo';

import { CONVERSION_PREPARE_QUEUE } from './conversion-jobs.constants';

/** Découpage SSML = CPU dans le processus de l'API (ADR-0009) : une préparation à la fois. */
const PREPARATION_CONCURRENCY = 1;

/** Payload validé avant typage : il a pu être écrit par une version antérieure du code. */
const preparePayload = z.object({ conversionId: z.uuid() });

/** Consommateur de `conversion-prepare` : glue BullMQ ↔ use-cases, aucune règle métier. */
@Injectable()
export class ConversionPreparationWorker
  implements JobHandler, OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(ConversionPreparationWorker.name);
  private worker: JobWorkerHandle | null = null;

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly prepare: PrepareConversionUseCase,
    private readonly failConversion: FailConversionUseCase,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.get('JOB_WORKERS_ENABLED', { infer: true })) return;
    this.worker = createJobWorker(
      CONVERSION_PREPARE_QUEUE,
      this,
      buildRedisOptions(this.config),
      PREPARATION_CONCURRENCY,
    );
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
  }

  async handle(job: Job): Promise<void> {
    const parsed = preparePayload.safeParse(job.data);
    // Un payload invalide ne deviendra pas valide en réessayant.
    if (!parsed.success) throw new UnrecoverableError('Invalid prepare-conversion payload');
    const { conversionId } = parsed.data;
    const outcome = await this.prepare.execute(ConversionId.of(conversionId));
    this.logger.log({ jobId: job.id, conversionId, outcome }, 'Preparation outcome');
    if (outcome.kind === 'failed') {
      // Log comptable (observability.md).
      this.logger.warn(
        { conversionId, step: 'prepare', code: outcome.reason },
        'conversion.failed',
      );
    }
  }

  async onFinalFailure(job: Job, error: Error): Promise<void> {
    const parsed = preparePayload.safeParse(job.data);
    if (!parsed.success) return; // payload illisible : aucune conversion à marquer
    const failed = await this.failConversion.execute(
      ConversionId.of(parsed.data.conversionId),
      ConversionFailureReason.INTERNAL,
    );
    if (failed) {
      this.logger.warn(
        { conversionId: parsed.data.conversionId, step: 'prepare', code: error.name },
        'conversion.failed',
      );
    }
  }
}
