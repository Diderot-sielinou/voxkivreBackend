import { Inject, Injectable } from '@nestjs/common';

import { CLOCK, type ClockPort, type DomainError, Result } from '@/shared/kernel';

import { type DocumentPage } from '../../domain/entities/document-page.entity';
import { DocumentNotFoundError } from '../../domain/errors/document-not-found.error';
import { DocumentPageNotFoundError } from '../../domain/errors/document-page-not-found.error';
import { DocumentTextNotReadyError } from '../../domain/errors/document-text-not-ready.error';
import {
  DOCUMENT_REPOSITORY,
  type DocumentRepositoryPort,
} from '../../domain/ports/document-repository.port';
import { countChars } from '../../domain/services/extracted-text';
import { type DocumentId } from '../../domain/value-objects/document-id.vo';
import { DocumentStatus } from '../../domain/value-objects/document-status.vo';
import { type OwnerId } from '../../domain/value-objects/owner-id.vo';
import { PageText } from '../../domain/value-objects/page-text.vo';

export interface UpdateDocumentPageInput {
  readonly ownerId: OwnerId;
  readonly documentId: DocumentId;
  readonly pageNumber: number;
  readonly text: string;
}

/**
 * `PUT /v1/documents/:id/pages/:pageNumber` (RF-06, DEC-07) : l'utilisateur
 * corrige le texte d'une page avant la synthèse — corriger en amont coûte
 * moins cher que de payer du TTS sur un texte faux. Le nombre de caractères
 * du document (base du quota) est recalculé dans la même transaction.
 */
@Injectable()
export class UpdateDocumentPageUseCase {
  constructor(
    @Inject(DOCUMENT_REPOSITORY) private readonly documents: DocumentRepositoryPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
  ) {}

  async execute(input: UpdateDocumentPageInput): Promise<Result<DocumentPage, DomainError>> {
    const document = await this.documents.findByIdForOwner(input.documentId, input.ownerId);
    if (document === null) return Result.err(new DocumentNotFoundError(input.documentId));
    if (document.status !== DocumentStatus.TEXT_READY) {
      return Result.err(new DocumentTextNotReadyError(document.id, document.status));
    }

    const text = PageText.of(input.text);
    if (text.isErr()) return Result.err(text.error);

    const page = await this.documents.updatePageText(
      document.id,
      input.pageNumber,
      text.value,
      countChars(text.value),
      this.clock.now(),
    );
    return page === null
      ? Result.err(new DocumentPageNotFoundError(document.id, input.pageNumber))
      : Result.ok(page);
  }
}
