import { Inject, Injectable } from '@nestjs/common';

import { CLOCK, type ClockPort } from '@/shared/kernel';
import { OBJECT_STORAGE, type ObjectStoragePort } from '@/shared/storage/object-storage.port';

import { type Document, isExtractionSettled } from '../../domain/entities/document.entity';
import {
  DOCUMENT_REPOSITORY,
  type DocumentRepositoryPort,
} from '../../domain/ports/document-repository.port';
import {
  EXTRACTION_SCHEDULER,
  type ExtractionSchedulerPort,
} from '../../domain/ports/extraction-scheduler.port';
import { OCR, type OcrPort } from '../../domain/ports/ocr.port';
import { prepareOcrText } from '../../domain/services/extracted-text';
import {
  firstMissingOcrPage,
  ocrBatchEnd,
  type OcrPage,
  requiresReview,
} from '../../domain/services/ocr';
import { type DocumentId } from '../../domain/value-objects/document-id.vo';
import {
  DocumentStatus,
  ExtractionFailureReason,
  ExtractionMethod,
} from '../../domain/value-objects/document-status.vo';
import { ExtractionSettler } from '../services/extraction-settler.service';

export type OcrBatchOutcome =
  | { readonly kind: 'batch_done'; readonly lastPage: number; readonly pageCount: number }
  | {
      readonly kind: 'text_ready';
      readonly pageCount: number;
      readonly charCount: number;
      readonly reviewRequired: boolean;
    }
  | { readonly kind: 'failed'; readonly reason: ExtractionFailureReason }
  | { readonly kind: 'skipped' };

/**
 * Tâche `ocr-pages` (ADR-0024) : reconnaît un lot de pages d'un scan, puis
 * programme le lot suivant **en fin de file** (les scans en cours avancent
 * à tour de rôle). Le dernier lot assemble tout le document : nettoyage
 * (ADR-0022), confiance par page, relecture imposée si elle est faible
 * (RF-06), puis suppression du PDF.
 *
 * **Idempotente** (RNF-12) : un lot déjà reconnu n'est pas refait ; les
 * pages sont réécrites par numéro ; le texte et le statut sont écrits dans
 * une transaction qui échoue sans effet si un autre lot l'a déjà fait.
 */
@Injectable()
export class RecognizeOcrPagesUseCase {
  constructor(
    @Inject(DOCUMENT_REPOSITORY) private readonly documents: DocumentRepositoryPort,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort,
    @Inject(OCR) private readonly ocr: OcrPort,
    @Inject(EXTRACTION_SCHEDULER) private readonly scheduler: ExtractionSchedulerPort,
    private readonly settler: ExtractionSettler,
    @Inject(CLOCK) private readonly clock: ClockPort,
  ) {}

  async execute(documentId: DocumentId, fromPage: number): Promise<OcrBatchOutcome> {
    const document = await this.documents.findById(documentId);
    if (document === null) return { kind: 'skipped' };
    if (isExtractionSettled(document)) {
      await this.settler.deleteSourceIfPresent(document);
      return { kind: 'skipped' };
    }
    const pageCount = document.ocrPageCount;
    if (
      document.status !== DocumentStatus.EXTRACTING ||
      document.extractionMethod !== ExtractionMethod.OCR ||
      pageCount === null ||
      fromPage < 1 ||
      fromPage > pageCount
    ) {
      return { kind: 'skipped' };
    }

    const lastPage = ocrBatchEnd(fromPage, pageCount);
    const done = new Set(await this.documents.listOcrPageNumbers(document.id));
    if (!coversRange(done, fromPage, lastPage)) {
      const recognized = await this.recognize(document, fromPage, lastPage);
      if (typeof recognized === 'string') return this.fail(document, recognized);
      for (const page of recognized) done.add(page.pageNumber);
    }

    // La première page manquante de **tout** le document : un lot perdu
    // (file indisponible, crash) est repris aussitôt, sans attendre le balayage.
    const next = firstMissingOcrPage([...done], pageCount);
    if (next !== null) {
      // Ne lève jamais : un lot non programmé est repris par le balayage.
      await this.scheduler.scheduleOcrBatch(document.id, next);
      return { kind: 'batch_done', lastPage, pageCount };
    }
    return this.complete(document);
  }

  /** Reconnaît et enregistre les pages, ou la raison d'un échec définitif. */
  private async recognize(
    document: Document,
    fromPage: number,
    lastPage: number,
  ): Promise<readonly OcrPage[] | ExtractionFailureReason> {
    const pdf = await this.storage.get(document.sourceKey);
    if (pdf === null) return ExtractionFailureReason.SOURCE_MISSING;
    const pages = await this.ocr.recognizePages(pdf, fromPage, lastPage);
    if (pages === null) return ExtractionFailureReason.UNREADABLE;
    await this.documents.saveOcrPages(document.id, pages, this.clock.now());
    return pages;
  }

  private async complete(document: Document): Promise<OcrBatchOutcome> {
    const prepared = prepareOcrText(await this.documents.listOcrPages(document.id));
    if (!prepared.ok) return this.fail(document, prepared.reason);

    const reviewRequired = requiresReview(prepared.pages.map((page) => page.ocrConfidence));
    await this.documents.completeExtraction(
      document.id,
      prepared.pages,
      prepared.charCount,
      { method: ExtractionMethod.OCR, reviewRequired },
      this.clock.now(),
    );
    await this.settler.deleteSourceIfPresent(document);
    return {
      kind: 'text_ready',
      pageCount: prepared.pages.length,
      charCount: prepared.charCount,
      reviewRequired,
    };
  }

  private async fail(
    document: Document,
    reason: ExtractionFailureReason,
  ): Promise<OcrBatchOutcome> {
    await this.settler.fail(document, reason);
    return { kind: 'failed', reason };
  }
}

/** Toutes les pages de `from` à `to` sont dans `done`. */
function coversRange(done: ReadonlySet<number>, from: number, to: number): boolean {
  for (let page = from; page <= to; page += 1) {
    if (!done.has(page)) return false;
  }
  return true;
}
