import { type ExtractionSchedulerPort } from '@/modules/document/domain/ports/extraction-scheduler.port';
import { type DocumentId } from '@/modules/document/domain/value-objects/document-id.vo';

export interface ScheduledOcrBatch {
  readonly documentId: DocumentId;
  readonly fromPage: number;
  readonly retryKey?: string;
}

/** Enregistre les documents et lots OCR programmés ; `available = false` simule une file en panne. */
export class FakeExtractionScheduler implements ExtractionSchedulerPort {
  readonly scheduled: DocumentId[] = [];
  readonly ocrBatches: ScheduledOcrBatch[] = [];
  available = true;

  schedule(documentId: DocumentId): Promise<boolean> {
    if (!this.available) return Promise.resolve(false);
    this.scheduled.push(documentId);
    return Promise.resolve(true);
  }

  scheduleOcrBatch(documentId: DocumentId, fromPage: number, retryKey?: string): Promise<boolean> {
    if (!this.available) return Promise.resolve(false);
    this.ocrBatches.push(
      retryKey === undefined ? { documentId, fromPage } : { documentId, fromPage, retryKey },
    );
    return Promise.resolve(true);
  }
}
