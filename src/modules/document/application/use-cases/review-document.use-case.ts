import { Inject, Injectable } from '@nestjs/common';

import { CLOCK, type ClockPort, type DomainError, Result } from '@/shared/kernel';

import { type Document } from '../../domain/entities/document.entity';
import { DocumentNotFoundError } from '../../domain/errors/document-not-found.error';
import { DocumentTextNotReadyError } from '../../domain/errors/document-text-not-ready.error';
import {
  DOCUMENT_REPOSITORY,
  type DocumentRepositoryPort,
} from '../../domain/ports/document-repository.port';
import { type DocumentId } from '../../domain/value-objects/document-id.vo';
import { DocumentStatus } from '../../domain/value-objects/document-status.vo';
import { type OwnerId } from '../../domain/value-objects/owner-id.vo';

/**
 * `POST /v1/documents/:id/review` (RF-06, ADR-0024) : l'utilisateur
 * confirme avoir relu le texte. Débloque la conversion d'un scan à
 * confiance faible ; sans effet (mais accepté) pour les autres documents.
 * Idempotent : la date de la première relecture est gardée.
 */
@Injectable()
export class ReviewDocumentUseCase {
  constructor(
    @Inject(DOCUMENT_REPOSITORY) private readonly documents: DocumentRepositoryPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
  ) {}

  async execute(input: {
    readonly ownerId: OwnerId;
    readonly documentId: DocumentId;
  }): Promise<Result<Document, DomainError>> {
    const document = await this.documents.findByIdForOwner(input.documentId, input.ownerId);
    if (document === null) return Result.err(new DocumentNotFoundError(input.documentId));
    if (document.status !== DocumentStatus.TEXT_READY) {
      return Result.err(new DocumentTextNotReadyError(document.id, document.status));
    }
    const reviewed = await this.documents.markReviewed(
      document.id,
      document.ownerId,
      this.clock.now(),
    );
    return reviewed === null
      ? Result.err(new DocumentNotFoundError(input.documentId))
      : Result.ok(reviewed);
  }
}
