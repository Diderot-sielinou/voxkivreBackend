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
import { PAID_ACCESS, type PaidAccessPort } from '../../domain/ports/paid-access.port';
import {
  PDF_TEXT_EXTRACTOR,
  type PdfTextExtractorPort,
} from '../../domain/ports/pdf-text-extractor.port';
import { isScanned, prepareExtractedText } from '../../domain/services/extracted-text';
import {
  checkOcrAllowance,
  OCR_FREE_PAGES_PER_MONTH,
  OCR_MAX_PAGES_PER_DOCUMENT,
  startOfOcrMonth,
} from '../../domain/services/ocr';
import { type DocumentId } from '../../domain/value-objects/document-id.vo';
import {
  DocumentStatus,
  ExtractionFailureReason,
  ExtractionMethod,
} from '../../domain/value-objects/document-status.vo';
import { ExtractionSettler } from '../services/extraction-settler.service';

export type ExtractionOutcome =
  | { readonly kind: 'text_ready'; readonly pageCount: number; readonly charCount: number }
  | { readonly kind: 'ocr_started'; readonly pageCount: number }
  | { readonly kind: 'failed'; readonly reason: ExtractionFailureReason }
  | { readonly kind: 'skipped' };

/**
 * Tâche `extract-text` (worker) : PDF → pages de texte → suppression du PDF.
 * Un PDF scanné passe à l'OCR (ADR-0024) : la tâche s'arrête après avoir
 * programmé le premier lot, le PDF reste jusqu'à la fin de l'OCR.
 *
 * **Idempotente** (RNF-12) — une tâche peut être rejouée après un crash à
 * n'importe quelle ligne :
 * - document déjà `text_ready`/`extraction_failed` : rien n'est refait,
 *   seule une suppression de PDF interrompue est terminée ;
 * - document déjà passé à l'OCR : rien n'est refait (ni plafond recompté,
 *   ni lot reprogrammé : le balayage de l'OCR s'en charge) ;
 * - pages + statut écrits dans **une** transaction : jamais de texte à moitié ;
 * - PDF supprimé **après** cette transaction : un crash entre les deux laisse
 *   un fichier que la relance supprime.
 *
 * Un PDF inexploitable (corrompu, vide, scan hors plafond) n'est pas une
 * panne : c'est un état `extraction_failed` avec une raison stable, sans
 * nouvel essai. Une panne (stockage, base) est levée : la file réessaie.
 */
@Injectable()
export class ExtractDocumentTextUseCase {
  constructor(
    @Inject(DOCUMENT_REPOSITORY) private readonly documents: DocumentRepositoryPort,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort,
    @Inject(PDF_TEXT_EXTRACTOR) private readonly extractor: PdfTextExtractorPort,
    @Inject(EXTRACTION_SCHEDULER) private readonly scheduler: ExtractionSchedulerPort,
    @Inject(PAID_ACCESS) private readonly paidAccess: PaidAccessPort,
    private readonly settler: ExtractionSettler,
    @Inject(CLOCK) private readonly clock: ClockPort,
  ) {}

  async execute(documentId: DocumentId): Promise<ExtractionOutcome> {
    const document = await this.documents.findById(documentId);
    if (document === null || document.status === DocumentStatus.AWAITING_UPLOAD) {
      return { kind: 'skipped' };
    }
    if (isExtractionSettled(document)) {
      await this.settler.deleteSourceIfPresent(document);
      return { kind: 'skipped' };
    }
    if (document.extractionMethod === ExtractionMethod.OCR) return { kind: 'skipped' };
    if (!(await this.documents.markExtracting(document.id, this.clock.now()))) {
      return { kind: 'skipped' };
    }

    const pdf = await this.storage.get(document.sourceKey);
    if (pdf === null) return this.fail(document, ExtractionFailureReason.SOURCE_MISSING);

    const extracted = await this.extractor.extract(pdf);
    if (extracted === null) return this.fail(document, ExtractionFailureReason.UNREADABLE);
    const { pages, bookmarks } = extracted;
    if (isScanned(pages)) return this.startOcr(document, pages.length);

    const prepared = prepareExtractedText(pages, bookmarks);
    if (!prepared.ok) return this.fail(document, prepared.reason);

    await this.documents.completeExtraction(
      document.id,
      prepared.pages,
      prepared.charCount,
      { method: ExtractionMethod.NATIVE, reviewRequired: false, outline: prepared.outline },
      this.clock.now(),
    );
    await this.settler.deleteSourceIfPresent(document);
    return { kind: 'text_ready', pageCount: prepared.pages.length, charCount: prepared.charCount };
  }

  /** Garde-fous (ADR-0024 D2), puis le premier lot. Le PDF reste dans le stockage. */
  private async startOcr(document: Document, pageCount: number): Promise<ExtractionOutcome> {
    const now = this.clock.now();
    const pagesUsedThisMonth = await this.documents.countOcrPagesSince(
      document.ownerId,
      startOfOcrMonth(now),
    );
    // `billing` n'est lu que si le plafond gratuit est en jeu.
    const hasPaidAccess =
      pageCount <= OCR_MAX_PAGES_PER_DOCUMENT &&
      pagesUsedThisMonth + pageCount > OCR_FREE_PAGES_PER_MONTH &&
      (await this.paidAccess.hasPaidAccess(document.ownerId));
    const refusal = checkOcrAllowance({ pageCount, pagesUsedThisMonth, hasPaidAccess });
    if (refusal !== null) return this.fail(document, refusal);

    if (!(await this.documents.startOcr(document.id, pageCount, now))) return { kind: 'skipped' };
    // Ne lève jamais : si la file est indisponible, le balayage de l'OCR reprendra.
    await this.scheduler.scheduleOcrBatch(document.id, 1);
    return { kind: 'ocr_started', pageCount };
  }

  private async fail(
    document: Document,
    reason: ExtractionFailureReason,
  ): Promise<ExtractionOutcome> {
    await this.settler.fail(document, reason);
    return { kind: 'failed', reason };
  }
}
