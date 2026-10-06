import { Inject, Injectable } from '@nestjs/common';

import { CLOCK, type ClockPort } from '@/shared/kernel';
import { OBJECT_STORAGE, type ObjectStoragePort } from '@/shared/storage/object-storage.port';

import { type Document, isExtractionSettled } from '../../domain/entities/document.entity';
import {
  DOCUMENT_REPOSITORY,
  type DocumentRepositoryPort,
} from '../../domain/ports/document-repository.port';
import {
  PDF_TEXT_EXTRACTOR,
  type PdfTextExtractorPort,
} from '../../domain/ports/pdf-text-extractor.port';
import { prepareExtractedText } from '../../domain/services/extracted-text';
import { type DocumentId } from '../../domain/value-objects/document-id.vo';
import {
  DocumentStatus,
  ExtractionFailureReason,
} from '../../domain/value-objects/document-status.vo';

export type ExtractionOutcome =
  | { readonly kind: 'text_ready'; readonly pageCount: number; readonly charCount: number }
  | { readonly kind: 'failed'; readonly reason: ExtractionFailureReason }
  | { readonly kind: 'skipped' };

/**
 * Tâche `extract-text` (worker) : PDF → pages de texte → suppression du PDF.
 *
 * **Idempotente** (RNF-12) — une tâche peut être rejouée après un crash à
 * n'importe quelle ligne :
 * - document déjà `text_ready`/`extraction_failed` : rien n'est refait,
 *   seule une suppression de PDF interrompue est terminée ;
 * - pages + statut écrits dans **une** transaction : jamais de texte à moitié ;
 * - PDF supprimé **après** cette transaction : un crash entre les deux laisse
 *   un fichier que la relance supprime.
 *
 * Un PDF inexploitable (scanné, corrompu, vide) n'est pas une panne : c'est
 * un état `extraction_failed` avec une raison stable, sans nouvel essai.
 * Une panne (stockage, base) est levée : la file réessaie.
 */
@Injectable()
export class ExtractDocumentTextUseCase {
  constructor(
    @Inject(DOCUMENT_REPOSITORY) private readonly documents: DocumentRepositoryPort,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort,
    @Inject(PDF_TEXT_EXTRACTOR) private readonly extractor: PdfTextExtractorPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
  ) {}

  async execute(documentId: DocumentId): Promise<ExtractionOutcome> {
    const document = await this.documents.findById(documentId);
    if (document === null || document.status === DocumentStatus.AWAITING_UPLOAD) {
      return { kind: 'skipped' };
    }
    if (isExtractionSettled(document)) {
      await this.deleteSourceIfPresent(document);
      return { kind: 'skipped' };
    }
    if (!(await this.documents.markExtracting(document.id, this.clock.now()))) {
      return { kind: 'skipped' };
    }

    const pdf = await this.storage.get(document.sourceKey);
    if (pdf === null) return this.fail(document, ExtractionFailureReason.SOURCE_MISSING);

    const pages = await this.extractor.extract(pdf);
    if (pages === null) return this.fail(document, ExtractionFailureReason.UNREADABLE);

    const prepared = prepareExtractedText(pages);
    if (!prepared.ok) return this.fail(document, prepared.reason);

    await this.documents.completeExtraction(
      document.id,
      prepared.pages,
      prepared.charCount,
      this.clock.now(),
    );
    await this.deleteSourceIfPresent(document);
    return { kind: 'text_ready', pageCount: prepared.pages.length, charCount: prepared.charCount };
  }

  private async fail(
    document: Document,
    reason: ExtractionFailureReason,
  ): Promise<ExtractionOutcome> {
    await this.documents.markExtractionFailed(document.id, reason, this.clock.now());
    // Le PDF n'est pas conservé non plus en cas d'échec (CdC §8) : l'utilisateur
    // le réimportera quand l'OCR (RF-04) saura le traiter.
    await this.deleteSourceIfPresent(document);
    return { kind: 'failed', reason };
  }

  private async deleteSourceIfPresent(document: Document): Promise<void> {
    if (document.sourceDeletedAt !== null) return;
    await this.storage.delete(document.sourceKey);
    await this.documents.markSourceDeleted(document.id, this.clock.now());
  }
}
