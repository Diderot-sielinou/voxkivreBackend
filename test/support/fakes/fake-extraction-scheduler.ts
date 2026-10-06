import { type ExtractionSchedulerPort } from '@/modules/document/domain/ports/extraction-scheduler.port';
import { type DocumentId } from '@/modules/document/domain/value-objects/document-id.vo';

/** Enregistre les documents programmés ; `available = false` simule une file en panne. */
export class FakeExtractionScheduler implements ExtractionSchedulerPort {
  readonly scheduled: DocumentId[] = [];
  available = true;

  schedule(documentId: DocumentId): Promise<boolean> {
    if (!this.available) return Promise.resolve(false);
    this.scheduled.push(documentId);
    return Promise.resolve(true);
  }
}
