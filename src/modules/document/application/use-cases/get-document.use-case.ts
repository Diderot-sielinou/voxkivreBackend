import { Inject, Injectable } from '@nestjs/common';

import { Result } from '@/shared/kernel';

import { type Document } from '../../domain/entities/document.entity';
import { DocumentNotFoundError } from '../../domain/errors/document-not-found.error';
import {
  DOCUMENT_REPOSITORY,
  type DocumentRepositoryPort,
} from '../../domain/ports/document-repository.port';
import { type DocumentId } from '../../domain/value-objects/document-id.vo';
import { type OwnerId } from '../../domain/value-objects/owner-id.vo';

/** `GET /v1/documents/:id` — quel que soit le statut, toujours filtré par propriétaire. */
@Injectable()
export class GetDocumentUseCase {
  constructor(@Inject(DOCUMENT_REPOSITORY) private readonly documents: DocumentRepositoryPort) {}

  async execute(input: {
    readonly ownerId: OwnerId;
    readonly documentId: DocumentId;
  }): Promise<Result<Document, DocumentNotFoundError>> {
    const document = await this.documents.findByIdForOwner(input.documentId, input.ownerId);
    return document === null
      ? Result.err(new DocumentNotFoundError(input.documentId))
      : Result.ok(document);
  }
}
