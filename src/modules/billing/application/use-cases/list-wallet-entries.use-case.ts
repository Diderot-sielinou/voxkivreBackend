import { Inject, Injectable } from '@nestjs/common';

import {
  buildPage,
  type CursorEncoder,
  type CursorPage,
  InvalidCursorError,
  Result,
} from '@/shared/kernel';
import { CURSOR_CODEC } from '@/shared/pagination/cursor-codec.constants';

import {
  WALLET_HISTORY,
  type WalletEntry,
  type WalletEntryPosition,
  type WalletHistoryPort,
} from '../../domain/ports/wallet-history.port';

/** Bornes de page (api-design.md : max 50, payload mobile). */
export const WALLET_PAGE_DEFAULT_LIMIT = 20;
export const WALLET_PAGE_MAX_LIMIT = 50;

export interface ListWalletEntriesInput {
  readonly userId: string;
  readonly cursor?: string;
  readonly limit?: number;
}

/**
 * `GET /v1/billing/wallet/entries` : historique des recharges, consommations
 * et remboursements (ADR-0019 §10), du plus récent au plus ancien, paginé par
 * cursor signé (ADR-0005).
 */
@Injectable()
export class ListWalletEntriesUseCase {
  constructor(
    @Inject(WALLET_HISTORY) private readonly history: WalletHistoryPort,
    @Inject(CURSOR_CODEC) private readonly cursors: CursorEncoder<string>,
  ) {}

  async execute(
    input: ListWalletEntriesInput,
  ): Promise<Result<CursorPage<WalletEntry>, InvalidCursorError>> {
    const limit = Math.min(
      Math.max(input.limit ?? WALLET_PAGE_DEFAULT_LIMIT, 1),
      WALLET_PAGE_MAX_LIMIT,
    );

    let after: WalletEntryPosition | null = null;
    if (input.cursor !== undefined) {
      const decoded = this.decode(input.cursor);
      if (decoded.isErr()) return Result.err(decoded.error);
      after = decoded.value;
    }

    // `limit + 1` : la ligne en trop signale qu'une page suivante existe.
    const rows = await this.history.listEntries(input.userId, after, limit + 1);
    return Result.ok(
      buildPage(
        rows,
        limit,
        (e) => ({ sort: e.createdAt.toISOString(), id: e.id }),
        (sort, id) => this.cursors.encode(sort, id),
      ),
    );
  }

  private decode(cursor: string): Result<WalletEntryPosition, InvalidCursorError> {
    const decoded = this.cursors.decode(cursor);
    if (decoded.isErr()) return Result.err(decoded.error);
    // Le payload est signé, mais son type n'est pas garanti (format futur).
    const sort: unknown = decoded.value.sort;
    const createdAt = typeof sort === 'string' ? new Date(sort) : null;
    if (createdAt === null || Number.isNaN(createdAt.getTime())) {
      return Result.err(new InvalidCursorError('Cursor sort key is not a valid date'));
    }
    return Result.ok({ createdAt, id: decoded.value.id });
  }
}
