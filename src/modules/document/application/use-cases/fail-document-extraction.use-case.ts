import { Inject, Injectable } from '@nestjs/common';

import { CLOCK, type ClockPort } from '@/shared/kernel';
import { OBJECT_STORAGE, type ObjectStoragePort } from '@/shared/storage/object-storage.port';

import { isExtractionSettled } from '../../domain/entities/document.entity';
import {
  DOCUMENT_REPOSITORY,
  type DocumentRepositoryPort,
} from '../../domain/ports/document-repository.port';
import { type DocumentId } from '../../domain/value-objects/document-id.vo';
import { ExtractionFailureReason } from '../../domain/value-objects/document-status.vo';

/**
 * Appelé quand la tâche `extract-text` a épuisé ses essais : le document
 * passe en `extraction_failed` (`internal`) au lieu de rester bloqué en
 * `extracting` — l'utilisateur est informé, jamais un échec silencieux
 * (RNF-11). La base est la file des échecs (jobs-and-pipeline.md).
 */
@Injectable()
export class FailDocumentExtractionUseCase {
  constructor(
    @Inject(DOCUMENT_REPOSITORY) private readonly documents: DocumentRepositoryPort,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort,
    @Inject(CLOCK) private readonly clock: ClockPort,
  ) {}

  async execute(documentId: DocumentId): Promise<void> {
    const document = await this.documents.findById(documentId);
    if (document === null || isExtractionSettled(document)) return;
    await this.documents.markExtractionFailed(
      document.id,
      ExtractionFailureReason.INTERNAL,
      this.clock.now(),
    );
    if (document.sourceDeletedAt === null) {
      await this.storage.delete(document.sourceKey);
      await this.documents.markSourceDeleted(document.id, this.clock.now());
    }
  }
}
