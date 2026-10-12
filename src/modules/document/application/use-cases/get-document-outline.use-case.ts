import { Inject, Injectable } from '@nestjs/common';

import { type DomainError, Result } from '@/shared/kernel';

import { DocumentNotFoundError } from '../../domain/errors/document-not-found.error';
import { DocumentTextNotReadyError } from '../../domain/errors/document-text-not-ready.error';
import {
  DOCUMENT_REPOSITORY,
  type DocumentRepositoryPort,
} from '../../domain/ports/document-repository.port';
import { type OutlineEntry, type OutlineSource } from '../../domain/services/outline';
import { type DocumentId } from '../../domain/value-objects/document-id.vo';
import { DocumentStatus } from '../../domain/value-objects/document-status.vo';
import { type OwnerId } from '../../domain/value-objects/owner-id.vo';

export interface DocumentOutlineView {
  /** `null` pour un document extrait avant la table des matières. */
  readonly source: OutlineSource | null;
  readonly entries: readonly OutlineEntry[];
}

/**
 * `GET /v1/documents/:id/outline` (RF-12, ADR-0027) : la table des matières
 * enregistrée à l'extraction. Disponible en `text_ready` (409 sinon) ; vide
 * pour un document d'avant (le PDF n'existe plus pour la recalculer).
 */
@Injectable()
export class GetDocumentOutlineUseCase {
  constructor(@Inject(DOCUMENT_REPOSITORY) private readonly documents: DocumentRepositoryPort) {}

  async execute(input: {
    readonly ownerId: OwnerId;
    readonly documentId: DocumentId;
  }): Promise<Result<DocumentOutlineView, DomainError>> {
    const document = await this.documents.findByIdForOwner(input.documentId, input.ownerId);
    if (document === null) return Result.err(new DocumentNotFoundError(input.documentId));
    if (document.status !== DocumentStatus.TEXT_READY) {
      return Result.err(new DocumentTextNotReadyError(document.id, document.status));
    }
    return Result.ok({
      source: document.outline?.source ?? null,
      entries: document.outline?.entries ?? [],
    });
  }
}
