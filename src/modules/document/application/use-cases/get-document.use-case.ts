import { Inject, Injectable } from '@nestjs/common';

import { Result } from '@/shared/kernel';

import { type Document } from '../../domain/entities/document.entity';
import { DocumentNotFoundError } from '../../domain/errors/document-not-found.error';
import {
  DOCUMENT_REPOSITORY,
  type DocumentRepositoryPort,
} from '../../domain/ports/document-repository.port';
import { type DocumentId } from '../../domain/value-objects/document-id.vo';
import { DocumentStatus, ExtractionMethod } from '../../domain/value-objects/document-status.vo';
import { type OwnerId } from '../../domain/value-objects/owner-id.vo';

export interface DocumentView {
  readonly document: Document;
  /** Pages déjà reconnues pendant un OCR (ADR-0024) ; `null` hors OCR en cours. */
  readonly ocrPagesDone: number | null;
}

/**
 * `GET /v1/documents/:id` — quel que soit le statut, toujours filtré par
 * propriétaire. Pendant un OCR, le mobile y suit la progression.
 */
@Injectable()
export class GetDocumentUseCase {
  constructor(@Inject(DOCUMENT_REPOSITORY) private readonly documents: DocumentRepositoryPort) {}

  async execute(input: {
    readonly ownerId: OwnerId;
    readonly documentId: DocumentId;
  }): Promise<Result<DocumentView, DocumentNotFoundError>> {
    const document = await this.documents.findByIdForOwner(input.documentId, input.ownerId);
    if (document === null) return Result.err(new DocumentNotFoundError(input.documentId));
    const ocrRunning =
      document.status === DocumentStatus.EXTRACTING &&
      document.extractionMethod === ExtractionMethod.OCR;
    if (!ocrRunning) return Result.ok({ document, ocrPagesDone: null });
    const done = await this.documents.listOcrPageNumbers(document.id);
    return Result.ok({ document, ocrPagesDone: done.length });
  }
}
