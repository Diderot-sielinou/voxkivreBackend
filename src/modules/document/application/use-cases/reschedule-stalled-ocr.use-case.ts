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
import { firstMissingOcrPage } from '../../domain/services/ocr';

/**
 * Sans progrès depuis ce délai, un OCR est considéré comme bloqué. Large :
 * un scan attend son tour derrière les autres (~35 s par lot et par scan en
 * cours, ADR-0024) ; une relance trop tôt referait un lot en double.
 */
export const STALLED_OCR_AFTER_MS = 30 * 60 * 1000;
export const RESCHEDULE_OCR_BATCH_SIZE = 50;

/**
 * Filet de sécurité (cron) : relance l'OCR des scans immobiles — lot non
 * programmé (file indisponible), tâche perdue. Reprend à la première page
 * manquante, ou au dernier lot si toutes sont reconnues (assemblage jamais
 * fait). `retryKey` à la minute : une tâche déjà terminée garde son `jobId`.
 * Renvoie le nombre de lots programmés.
 */
@Injectable()
export class RescheduleStalledOcrUseCase {
  constructor(
    @Inject(DOCUMENT_REPOSITORY) private readonly documents: DocumentRepositoryPort,
    @Inject(EXTRACTION_SCHEDULER) private readonly scheduler: ExtractionSchedulerPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
  ) {}

  async execute(): Promise<number> {
    const now = this.clock.now().getTime();
    const stalled = await this.documents.findStalledOcr(
      new Date(now - STALLED_OCR_AFTER_MS),
      RESCHEDULE_OCR_BATCH_SIZE,
    );
    const retryKey = `sweep-${String(Math.floor(now / 60_000))}`;
    let scheduled = 0;
    for (const id of stalled) {
      const document = await this.documents.findById(id);
      const pageCount = document?.ocrPageCount ?? null;
      if (pageCount === null) continue;
      const done = await this.documents.listOcrPageNumbers(id);
      const fromPage = firstMissingOcrPage(done, pageCount) ?? pageCount;
      if (await this.scheduler.scheduleOcrBatch(id, fromPage, retryKey)) scheduled += 1;
    }
    return scheduled;
  }
}
