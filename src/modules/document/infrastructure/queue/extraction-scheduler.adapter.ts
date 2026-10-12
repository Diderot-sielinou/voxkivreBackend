import { Inject, Injectable, Logger } from '@nestjs/common';

import { JOB_QUEUE, type JobQueuePort } from '@/shared/queue/job-queue.port';

import { type ExtractionSchedulerPort } from '../../domain/ports/extraction-scheduler.port';
import { type DocumentId } from '../../domain/value-objects/document-id.vo';

import {
  DOCUMENT_OCR_QUEUE,
  DOCUMENT_QUEUE,
  EXTRACT_TEXT_ATTEMPTS,
  EXTRACT_TEXT_JOB,
  extractTextJobId,
  OCR_PAGES_ATTEMPTS,
  OCR_PAGES_JOB,
  ocrPagesJobId,
} from './document-jobs.constants';

/**
 * Programme `extract-text` dans BullMQ. Respecte le contrat du port : ne
 * lève jamais — une file indisponible est loggée (`warn`) et rattrapée par
 * le balayage périodique (`RescheduleStalledExtractionsJob`).
 */
@Injectable()
export class QueueExtractionScheduler implements ExtractionSchedulerPort {
  private readonly logger = new Logger(QueueExtractionScheduler.name);

  constructor(@Inject(JOB_QUEUE) private readonly queue: JobQueuePort) {}

  async schedule(documentId: DocumentId): Promise<boolean> {
    try {
      await this.queue.enqueue({
        queue: DOCUMENT_QUEUE,
        name: EXTRACT_TEXT_JOB,
        jobId: extractTextJobId(documentId),
        payload: { documentId },
        attempts: EXTRACT_TEXT_ATTEMPTS,
      });
      return true;
    } catch (error) {
      this.logger.warn(
        { err: error, documentId },
        'Extraction not scheduled; the stalled-extraction sweeper will retry',
      );
      return false;
    }
  }

  async scheduleOcrBatch(
    documentId: DocumentId,
    fromPage: number,
    retryKey?: string,
  ): Promise<boolean> {
    try {
      await this.queue.enqueue({
        queue: DOCUMENT_OCR_QUEUE,
        name: OCR_PAGES_JOB,
        jobId: ocrPagesJobId(documentId, fromPage, retryKey),
        payload: { documentId, fromPage },
        attempts: OCR_PAGES_ATTEMPTS,
      });
      return true;
    } catch (error) {
      this.logger.warn(
        { err: error, documentId, fromPage },
        'OCR batch not scheduled; the stalled-OCR sweeper will retry',
      );
      return false;
    }
  }
}
