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

import { FailDocumentExtractionUseCase } from '../../application/use-cases/fail-document-extraction.use-case';
import { RecognizeOcrPagesUseCase } from '../../application/use-cases/recognize-ocr-pages.use-case';
import { DocumentId } from '../../domain/value-objects/document-id.vo';

import { DOCUMENT_OCR_QUEUE } from './document-jobs.constants';

/**
 * Un lot à la fois : Tesseract occupe un cœur, l'API garde l'autre
 * (ADR-0024, mesuré sur l'instance). Les scans avancent à tour de rôle
 * parce que chaque lot programme le suivant en fin de file.
 */
const OCR_CONCURRENCY = 1;

/** Payload validé avant typage : il a pu être écrit par une version antérieure du code. */
const ocrPagesPayload = z.object({ documentId: z.uuid(), fromPage: z.number().int().min(1) });

/**
 * Consommateur de la file `document-ocr` : glue BullMQ ↔ use-cases, aucune
 * règle métier ici. Démarré au bootstrap si `JOB_WORKERS_ENABLED`, fermé
 * proprement au drain (`worker.close()` attend le lot en cours).
 */
@Injectable()
export class DocumentOcrWorker
  implements JobHandler, OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(DocumentOcrWorker.name);
  private worker: JobWorkerHandle | null = null;

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly recognize: RecognizeOcrPagesUseCase,
    private readonly failExtraction: FailDocumentExtractionUseCase,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.get('JOB_WORKERS_ENABLED', { infer: true })) return;
    this.worker = createJobWorker(
      DOCUMENT_OCR_QUEUE,
      this,
      buildRedisOptions(this.config),
      OCR_CONCURRENCY,
    );
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
  }

  async handle(job: Job): Promise<void> {
    const parsed = ocrPagesPayload.safeParse(job.data);
    // Un payload invalide ne deviendra pas valide en réessayant.
    if (!parsed.success) throw new UnrecoverableError('Invalid ocr-pages payload');
    const outcome = await this.recognize.execute(
      DocumentId.of(parsed.data.documentId),
      parsed.data.fromPage,
    );
    this.logger.log({ jobId: job.id, outcome }, 'OCR batch outcome');
  }

  async onFinalFailure(job: Job): Promise<void> {
    const parsed = ocrPagesPayload.safeParse(job.data);
    if (!parsed.success) return; // payload illisible : aucun document à marquer
    await this.failExtraction.execute(DocumentId.of(parsed.data.documentId));
  }
}
