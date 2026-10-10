import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, lt, or } from 'drizzle-orm';

import { DRIZZLE_CLIENT, type DrizzleClient } from '@/shared/persistence';

import { type CreditEntryKind } from '../../domain/credit-entry';
import {
  type WalletEntry,
  type WalletEntryPosition,
  type WalletHistoryPort,
} from '../../domain/ports/wallet-history.port';

import { creditEntries } from './schema/billing.schema';

/** Journal du portefeuille, paginé par keyset (index `credit_entries_user_created_idx`). */
@Injectable()
export class DrizzleWalletHistory implements WalletHistoryPort {
  constructor(@Inject(DRIZZLE_CLIENT) private readonly db: DrizzleClient) {}

  async listEntries(
    userId: string,
    after: WalletEntryPosition | null,
    limit: number,
  ): Promise<readonly WalletEntry[]> {
    // Keyset `(created_at, id) < (after.createdAt, after.id)` en ordre DESC.
    const rows = await this.db
      .select({
        id: creditEntries.id,
        kind: creditEntries.kind,
        units: creditEntries.units,
        createdAt: creditEntries.createdAt,
        offerCode: creditEntries.offerCode,
        reservationId: creditEntries.reservationId,
      })
      .from(creditEntries)
      .where(
        and(
          eq(creditEntries.userId, userId),
          after === null
            ? undefined
            : or(
                lt(creditEntries.createdAt, after.createdAt),
                and(eq(creditEntries.createdAt, after.createdAt), lt(creditEntries.id, after.id)),
              ),
        ),
      )
      .orderBy(desc(creditEntries.createdAt), desc(creditEntries.id))
      .limit(limit);
    // Invariant : contrainte `credit_entries_kind_check`.
    return rows.map((row) => ({ ...row, kind: row.kind as CreditEntryKind }));
  }
}
