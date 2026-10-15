import { Inject, Injectable } from '@nestjs/common';

import { CLOCK, type ClockPort, type DomainError, Result } from '@/shared/kernel';

import { type Document } from '../../domain/entities/document.entity';
import { DocumentNotFoundError } from '../../domain/errors/document-not-found.error';
import {
  DOCUMENT_REPOSITORY,
  type DocumentRepositoryPort,
} from '../../domain/ports/document-repository.port';
import { type DocumentId } from '../../domain/value-objects/document-id.vo';
import { DocumentTitle } from '../../domain/value-objects/document-title.vo';
import { type OwnerId } from '../../domain/value-objects/owner-id.vo';

/**
 * `PATCH /v1/documents/:id` : l'utilisateur renomme un document (le titre
 * d'un PDF est souvent un nom de fichier). Mêmes règles qu'à l'import
 * (1..200 caractères, espaces normalisés). Tout statut : le titre n'entre ni
 * dans le texte lu ni dans la conversion.
 */
@Injectable()
export class RenameDocumentUseCase {
  constructor(
    @Inject(DOCUMENT_REPOSITORY) private readonly documents: DocumentRepositoryPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
  ) {}

  async execute(input: {
    readonly ownerId: OwnerId;
    readonly documentId: DocumentId;
    readonly title: string;
  }): Promise<Result<Document, DomainError>> {
    const title = DocumentTitle.of(input.title);
    if (title.isErr()) return Result.err(title.error);
    const renamed = await this.documents.rename(
      input.documentId,
      input.ownerId,
      title.value,
      this.clock.now(),
    );
    return renamed === null
      ? Result.err(new DocumentNotFoundError(input.documentId))
      : Result.ok(renamed);
  }
}
