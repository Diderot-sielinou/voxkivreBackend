import { Inject, Injectable } from '@nestjs/common';

import {
  buildPage,
  type CursorEncoder,
  type CursorPage,
  InvalidCursorError,
  Result,
} from '@/shared/kernel';
import { CURSOR_CODEC } from '@/shared/pagination/cursor-codec.constants';

import { type Document } from '../../domain/entities/document.entity';
import {
  DOCUMENT_REPOSITORY,
  type DocumentPagePosition,
  type DocumentRepositoryPort,
} from '../../domain/ports/document-repository.port';
import { DocumentId } from '../../domain/value-objects/document-id.vo';
import { type OwnerId } from '../../domain/value-objects/owner-id.vo';

/** Bornes de page (api-design.md : max 50, payload mobile). */
export const DOCUMENT_PAGE_DEFAULT_LIMIT = 20;
export const DOCUMENT_PAGE_MAX_LIMIT = 50;

export interface ListDocumentsInput {
  readonly ownerId: OwnerId;
  readonly cursor?: string;
  readonly limit?: number;
}

/**
 * `GET /v1/documents` : documents **importés** du propriétaire, du plus
 * récent au plus ancien, paginés par cursor signé (ADR-0005). Les documents
 * `awaiting_upload` sont exclus : ce sont des imports en cours ou abandonnés,
 * pas encore des livres de la bibliothèque.
 */
@Injectable()
export class ListDocumentsUseCase {
  constructor(
    @Inject(DOCUMENT_REPOSITORY) private readonly documents: DocumentRepositoryPort,
    @Inject(CURSOR_CODEC) private readonly cursors: CursorEncoder<string>,
  ) {}

  async execute(
    input: ListDocumentsInput,
  ): Promise<Result<CursorPage<Document>, InvalidCursorError>> {
    const limit = Math.min(
      Math.max(input.limit ?? DOCUMENT_PAGE_DEFAULT_LIMIT, 1),
      DOCUMENT_PAGE_MAX_LIMIT,
    );

    let after: DocumentPagePosition | null = null;
    if (input.cursor !== undefined) {
      const decoded = this.decode(input.cursor);
      if (decoded.isErr()) return Result.err(decoded.error);
      after = decoded.value;
    }

    // `limit + 1` : la ligne en trop signale qu'une page suivante existe.
    const rows = await this.documents.listUploadedByOwner(input.ownerId, after, limit + 1);
    return Result.ok(
      buildPage(
        rows,
        limit,
        (d) => ({ sort: d.createdAt.toISOString(), id: d.id }),
        (sort, id) => this.cursors.encode(sort, id),
      ),
    );
  }

  private decode(cursor: string): Result<DocumentPagePosition, InvalidCursorError> {
    const decoded = this.cursors.decode(cursor);
    if (decoded.isErr()) return Result.err(decoded.error);
    // Le payload est signé, mais son type n'est pas garanti (format futur).
    const sort: unknown = decoded.value.sort;
    const createdAt = typeof sort === 'string' ? new Date(sort) : null;
    if (createdAt === null || Number.isNaN(createdAt.getTime())) {
      return Result.err(new InvalidCursorError('Cursor sort key is not a valid date'));
    }
    return Result.ok({ createdAt, id: DocumentId.of(decoded.value.id) });
  }
}
