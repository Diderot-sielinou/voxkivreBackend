import { Inject, Injectable } from '@nestjs/common';

import {
  buildPage,
  type CursorEncoder,
  type CursorPage,
  InvalidCursorError,
  Result,
} from '@/shared/kernel';
import { CURSOR_CODEC } from '@/shared/pagination/cursor-codec.constants';

import { type ReadingPosition } from '../../domain/entities/reading-position.entity';
import {
  LIBRARY_CONVERSIONS,
  type LibraryConversion,
  type LibraryConversionsPort,
} from '../../domain/ports/library-conversions.port';
import {
  LIBRARY_DOCUMENTS,
  type LibraryCursorPosition,
  type LibraryDocument,
  type LibraryDocumentsPort,
} from '../../domain/ports/library-documents.port';
import {
  READING_POSITION_REPOSITORY,
  type ReadingPositionRepositoryPort,
} from '../../domain/ports/reading-position-repository.port';
import { deriveLibraryStatus, progressPercent } from '../../domain/services/library-status';
import { type LibraryItemStatus } from '../../domain/value-objects/library-item-status.vo';

/** Bornes de page (api-design.md : max 50, payload mobile). */
export const LIBRARY_PAGE_DEFAULT_LIMIT = 20;
export const LIBRARY_PAGE_MAX_LIMIT = 50;

export interface LibraryItem {
  readonly document: LibraryDocument;
  readonly conversion: LibraryConversion | null;
  readonly position: ReadingPosition | null;
  readonly status: LibraryItemStatus;
  readonly progressPercent: number | null;
}

export interface ListLibraryInput {
  readonly ownerId: string;
  readonly cursor?: string;
  readonly limit?: number;
}

/**
 * `GET /v1/library` (RF-17, ADR-0015) : un élément par document importé,
 * avec sa conversion retenue, sa position et un statut dérivé. Paginé par
 * cursor signé sur la date d'import. Trois requêtes par page, une par
 * module (documents, conversions + parties, positions) : pas de N+1.
 */
@Injectable()
export class ListLibraryUseCase {
  constructor(
    @Inject(LIBRARY_DOCUMENTS) private readonly documents: LibraryDocumentsPort,
    @Inject(LIBRARY_CONVERSIONS) private readonly conversions: LibraryConversionsPort,
    @Inject(READING_POSITION_REPOSITORY) private readonly positions: ReadingPositionRepositoryPort,
    @Inject(CURSOR_CODEC) private readonly cursors: CursorEncoder<string>,
  ) {}

  async execute(
    input: ListLibraryInput,
  ): Promise<Result<CursorPage<LibraryItem>, InvalidCursorError>> {
    const limit = Math.min(
      Math.max(input.limit ?? LIBRARY_PAGE_DEFAULT_LIMIT, 1),
      LIBRARY_PAGE_MAX_LIMIT,
    );

    let after: LibraryCursorPosition | null = null;
    if (input.cursor !== undefined) {
      const decoded = this.decode(input.cursor);
      if (decoded.isErr()) return Result.err(decoded.error);
      after = decoded.value;
    }

    // `limit + 1` : la ligne en trop signale qu'une page suivante existe.
    const rows = await this.documents.listForOwner(input.ownerId, after, limit + 1);
    const page = buildPage(
      rows,
      limit,
      (d) => ({ sort: d.createdAt.toISOString(), id: d.documentId }),
      (sort, id) => this.cursors.encode(sort, id),
    );

    const conversions = await this.conversions.forDocuments(
      input.ownerId,
      page.items.map((d) => d.documentId),
    );
    const known = await this.positions.findForConversions(
      input.ownerId,
      [...conversions.values()].map((c) => c.conversionId),
    );
    const positions = new Map(known.map((p) => [p.conversionId, p] as const));

    return Result.ok({
      items: page.items.map((document) => {
        const conversion = conversions.get(document.documentId) ?? null;
        const position =
          conversion === null ? null : (positions.get(conversion.conversionId) ?? null);
        return {
          document,
          conversion,
          position,
          status: deriveLibraryStatus(document.state, conversion, position),
          progressPercent: progressPercent(position, conversion),
        };
      }),
      nextCursor: page.nextCursor,
    });
  }

  private decode(cursor: string): Result<LibraryCursorPosition, InvalidCursorError> {
    const decoded = this.cursors.decode(cursor);
    if (decoded.isErr()) return Result.err(decoded.error);
    // Le payload est signé, mais son type n'est pas garanti (format futur).
    const sort: unknown = decoded.value.sort;
    const createdAt = typeof sort === 'string' ? new Date(sort) : null;
    if (createdAt === null || Number.isNaN(createdAt.getTime())) {
      return Result.err(new InvalidCursorError('Cursor sort key is not a valid date'));
    }
    return Result.ok({ createdAt, documentId: decoded.value.id });
  }
}
