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

import { AssemblePartUseCase } from '../../application/use-cases/assemble-part.use-case';
import { ConversionId } from '../../domain/value-objects/conversion-id.vo';

import { CONVERSION_ASSEMBLY_QUEUE } from './conversion-jobs.constants';

/** Lectures/écritures de stockage et une copie mémoire de ~2,5 Mo : un assemblage à la fois. */
const ASSEMBLY_CONCURRENCY = 1;

const assemblePayload = z.object({
  conversionId: z.uuid(),
  partIndex: z.number().int().nonnegative(),
});

/** Consommateur de `conversion-assembly` : glue BullMQ ↔ use-case, aucune règle métier. */
@Injectable()
export class PartAssemblyWorker
  implements JobHandler, OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(PartAssemblyWorker.name);
  private worker: JobWorkerHandle | null = null;

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly assemble: AssemblePartUseCase,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.get('JOB_WORKERS_ENABLED', { infer: true })) return;
    this.worker = createJobWorker(
      CONVERSION_ASSEMBLY_QUEUE,
      this,
      buildRedisOptions(this.config),
      ASSEMBLY_CONCURRENCY,
    );
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
  }

  async handle(job: Job): Promise<void> {
    const parsed = assemblePayload.safeParse(job.data);
    if (!parsed.success) throw new UnrecoverableError('Invalid assemble-part payload');
    const { conversionId, partIndex } = parsed.data;
    const outcome = await this.assemble.execute(ConversionId.of(conversionId), partIndex);
    this.logger.log({ jobId: job.id, conversionId, partIndex, outcome }, 'Assembly outcome');
    if (outcome.kind === 'assembled' && outcome.conversionReady) {
      // Log comptable (observability.md).
      this.logger.log({ conversionId }, 'conversion.completed');
    }
  }

  onFinalFailure(job: Job, error: Error): Promise<void> {
    // La synthèse est payée : on n'échoue pas la conversion, le balayage
    // relancera l'assemblage (ADR-0011). Signalé pour investigation.
    this.logger.error(
      { jobId: job.id, data: job.data as unknown, err: error },
      'Part assembly failed after all attempts; the sweeper will retry',
    );
    return Promise.resolve();
  }
}
