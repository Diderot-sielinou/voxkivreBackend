import { Inject, Injectable } from '@nestjs/common';

import {
  buildPage,
  type CursorEncoder,
  type CursorPage,
  type DomainError,
  InvalidCursorError,
  Result,
} from '@/shared/kernel';
import { CURSOR_CODEC } from '@/shared/pagination/cursor-codec.constants';

import { type DocumentPage } from '../../domain/entities/document-page.entity';
import { DocumentNotFoundError } from '../../domain/errors/document-not-found.error';
import { DocumentTextNotReadyError } from '../../domain/errors/document-text-not-ready.error';
import {
  DOCUMENT_REPOSITORY,
  type DocumentRepositoryPort,
} from '../../domain/ports/document-repository.port';
import { type DocumentId } from '../../domain/value-objects/document-id.vo';
import { DocumentStatus } from '../../domain/value-objects/document-status.vo';
import { type OwnerId } from '../../domain/value-objects/owner-id.vo';

/** Pages par écran de validation (une page ≈ 2 à 3 Ko de texte). */
export const PAGES_DEFAULT_LIMIT = 10;
export const PAGES_MAX_LIMIT = 50;

export interface ListDocumentPagesInput {
  readonly ownerId: OwnerId;
  readonly documentId: DocumentId;
  readonly cursor?: string;
  readonly limit?: number;
}

/**
 * `GET /v1/documents/:id/pages` : texte extrait, page par page, pour l'écran
 * de validation (RF-06). Disponible seulement en `text_ready` (409 sinon,
 * avec le statut courant). Cursor signé (ADR-0005) lié au document : un
 * cursor d'un autre document est rejeté.
 */
@Injectable()
export class ListDocumentPagesUseCase {
  constructor(
    @Inject(DOCUMENT_REPOSITORY) private readonly documents: DocumentRepositoryPort,
    @Inject(CURSOR_CODEC) private readonly cursors: CursorEncoder<string>,
  ) {}

  async execute(
    input: ListDocumentPagesInput,
  ): Promise<Result<CursorPage<DocumentPage>, DomainError>> {
    const document = await this.documents.findByIdForOwner(input.documentId, input.ownerId);
    if (document === null) return Result.err(new DocumentNotFoundError(input.documentId));
    if (document.status !== DocumentStatus.TEXT_READY) {
      return Result.err(new DocumentTextNotReadyError(document.id, document.status));
    }

    const limit = Math.min(Math.max(input.limit ?? PAGES_DEFAULT_LIMIT, 1), PAGES_MAX_LIMIT);
    let afterPage = 0;
    if (input.cursor !== undefined) {
      const decoded = this.decode(input.cursor, document.id);
      if (decoded.isErr()) return Result.err(decoded.error);
      afterPage = decoded.value;
    }

    const rows = await this.documents.listPages(document.id, afterPage, limit + 1);
    return Result.ok(
      buildPage(
        rows,
        limit,
        (p) => ({ sort: String(p.pageNumber), id: p.documentId }),
        (sort, id) => this.cursors.encode(sort, id),
      ),
    );
  }

  private decode(cursor: string, documentId: DocumentId): Result<number, InvalidCursorError> {
    const decoded = this.cursors.decode(cursor);
    if (decoded.isErr()) return Result.err(decoded.error);
    const sort: unknown = decoded.value.sort;
    const pageNumber = typeof sort === 'string' ? Number(sort) : Number.NaN;
    if (decoded.value.id !== documentId || !Number.isSafeInteger(pageNumber) || pageNumber < 1) {
      return Result.err(new InvalidCursorError('Cursor does not belong to this document'));
    }
    return Result.ok(pageNumber);
  }
}
