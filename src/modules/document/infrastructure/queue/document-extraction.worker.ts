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

import { ExtractDocumentTextUseCase } from '../../application/use-cases/extract-document-text.use-case';
import { FailDocumentExtractionUseCase } from '../../application/use-cases/fail-document-extraction.use-case';
import { DocumentId } from '../../domain/value-objects/document-id.vo';

import { DOCUMENT_QUEUE } from './document-jobs.constants';

/**
 * Une extraction à la fois : pdf.js est du CPU dans le **même processus**
 * que l'API (ADR-0009). Le débit est borné par le CPU, pas par la file.
 */
const EXTRACTION_CONCURRENCY = 1;

/** Payload validé avant typage : il a pu être écrit par une version antérieure du code. */
const extractTextPayload = z.object({ documentId: z.uuid() });

/**
 * Consommateur de la file `document` : glue BullMQ ↔ use-cases, aucune règle
 * métier ici. Démarré au bootstrap si `JOB_WORKERS_ENABLED`, fermé
 * proprement au drain (`worker.close()` attend la tâche en cours).
 */
@Injectable()
export class DocumentExtractionWorker
  implements JobHandler, OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(DocumentExtractionWorker.name);
  private worker: JobWorkerHandle | null = null;

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly extract: ExtractDocumentTextUseCase,
    private readonly failExtraction: FailDocumentExtractionUseCase,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.get('JOB_WORKERS_ENABLED', { infer: true })) return;
    this.worker = createJobWorker(
      DOCUMENT_QUEUE,
      this,
      buildRedisOptions(this.config),
      EXTRACTION_CONCURRENCY,
    );
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
  }

  async handle(job: Job): Promise<void> {
    const outcome = await this.extract.execute(this.documentIdOf(job));
    this.logger.log({ jobId: job.id, outcome }, 'Extraction outcome');
  }

  async onFinalFailure(job: Job): Promise<void> {
    const parsed = extractTextPayload.safeParse(job.data);
    if (!parsed.success) return; // payload illisible : aucun document à marquer
    await this.failExtraction.execute(DocumentId.of(parsed.data.documentId));
  }

  private documentIdOf(job: Job): DocumentId {
    const parsed = extractTextPayload.safeParse(job.data);
    // Un payload invalide ne deviendra pas valide en réessayant.
    if (!parsed.success) throw new UnrecoverableError('Invalid extract-text payload');
    return DocumentId.of(parsed.data.documentId);
  }
}
