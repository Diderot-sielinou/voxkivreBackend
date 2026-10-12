import { Inject, Injectable } from '@nestjs/common';

import { CLOCK, type ClockPort } from '@/shared/kernel';
import { OBJECT_STORAGE, type ObjectStoragePort } from '@/shared/storage/object-storage.port';

import { type Document } from '../../domain/entities/document.entity';
import {
  DOCUMENT_REPOSITORY,
  type DocumentRepositoryPort,
} from '../../domain/ports/document-repository.port';
import { type ExtractionFailureReason } from '../../domain/value-objects/document-status.vo';

/**
 * Fin d'une extraction, native ou OCR (ADR-0009, ADR-0024) : marquer
 * l'échec avec sa raison, et supprimer le PDF source **une seule fois**
 * (CdC §8), y compris après un crash entre la fin et la suppression.
 */
@Injectable()
export class ExtractionSettler {
  constructor(
    @Inject(DOCUMENT_REPOSITORY) private readonly documents: DocumentRepositoryPort,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort,
    @Inject(CLOCK) private readonly clock: ClockPort,
  ) {}

  /** `extraction_failed` avec la raison, puis le PDF est supprimé (pas gardé en cas d'échec). */
  async fail(document: Document, reason: ExtractionFailureReason): Promise<void> {
    await this.documents.markExtractionFailed(document.id, reason, this.clock.now());
    await this.deleteSourceIfPresent(document);
  }

  async deleteSourceIfPresent(document: Document): Promise<void> {
    if (document.sourceDeletedAt !== null) return;
    await this.storage.delete(document.sourceKey);
    await this.documents.markSourceDeleted(document.id, this.clock.now());
  }
}
