import { Inject, Injectable } from '@nestjs/common';

import { CLOCK, type ClockPort } from '@/shared/kernel';

import {
  DOCUMENT_REPOSITORY,
  type DocumentRepositoryPort,
} from '../../domain/ports/document-repository.port';
import {
  EXTRACTION_SCHEDULER,
  type ExtractionSchedulerPort,
} from '../../domain/ports/extraction-scheduler.port';

/** Délai avant de considérer qu'une extraction n'a jamais été programmée. */
export const STALLED_UPLOAD_AFTER_MS = 2 * 60 * 1000;
export const RESCHEDULE_BATCH_SIZE = 200;

/**
 * Filet de sécurité (cron) : reprogramme l'extraction des documents restés
 * `uploaded` — la mise en file a échoué à la confirmation (Redis
 * indisponible) ou la tâche a été perdue. Sûr à répéter : programmer deux
 * fois le même document est sans effet. Renvoie le nombre programmé.
 */
@Injectable()
export class RescheduleStalledExtractionsUseCase {
  constructor(
    @Inject(DOCUMENT_REPOSITORY) private readonly documents: DocumentRepositoryPort,
    @Inject(EXTRACTION_SCHEDULER) private readonly extraction: ExtractionSchedulerPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
  ) {}

  async execute(): Promise<number> {
    const before = new Date(this.clock.now().getTime() - STALLED_UPLOAD_AFTER_MS);
    const stalled = await this.documents.findStalledUploads(before, RESCHEDULE_BATCH_SIZE);
    let scheduled = 0;
    for (const id of stalled) {
      if (await this.extraction.schedule(id)) scheduled += 1;
    }
    return scheduled;
  }
}
