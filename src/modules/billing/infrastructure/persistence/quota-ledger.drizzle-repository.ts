import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';

import { DRIZZLE_CLIENT, type DrizzleClient } from '@/shared/persistence';

import {
  type QuotaLedgerPort,
  type ReserveCharsInput,
  type ReserveOutcome,
} from '../../domain/ports/quota-ledger.port';
import { type QuotaPeriod } from '../../domain/value-objects/quota-period.vo';

import { quotaReservations, quotaUsage } from './schema/billing.schema';

/** Compteurs de quota en SQL (ADR-0010). */
@Injectable()
export class DrizzleQuotaLedger implements QuotaLedgerPort {
  private readonly logger = new Logger(DrizzleQuotaLedger.name);

  constructor(@Inject(DRIZZLE_CLIENT) private readonly db: DrizzleClient) {}

  async reserve(input: ReserveCharsInput, tx?: unknown): Promise<ReserveOutcome> {
    const db = this.client(tx);
    // 1. La trace d'abord : une opération déjà réservée ne redébite pas.
    const traced = await db
      .insert(quotaReservations)
      .values({
        reservationId: input.reservationId,
        userId: input.userId,
        period: input.period,
        chars: input.chars,
        createdAt: input.at,
      })
      .onConflictDoNothing({ target: quotaReservations.reservationId })
      .returning({ id: quotaReservations.reservationId });
    if (traced.length === 0) return 'already_reserved';

    // 2. Incrément conditionnel, en une instruction (verrou de ligne implicite).
    //    Première réservation du mois : l'INSERT passe sans le WHERE, d'où la
    //    garantie `chars <= limit` vérifiée en amont par le use-case.
    const counted = await db
      .insert(quotaUsage)
      .values({
        userId: input.userId,
        period: input.period,
        reservedChars: input.chars,
        updatedAt: input.at,
      })
      .onConflictDoUpdate({
        target: [quotaUsage.userId, quotaUsage.period],
        set: {
          reservedChars: sql`${quotaUsage.reservedChars} + excluded.reserved_chars`,
          updatedAt: input.at,
        },
        setWhere: sql`${quotaUsage.reservedChars} + excluded.reserved_chars <= ${input.limit}`,
      })
      .returning({ reservedChars: quotaUsage.reservedChars });
    const counter = counted.at(0);
    if (counter !== undefined) {
      // Log comptable (observability.md) : identifiants, jamais de PII.
      this.logger.log(
        {
          userId: input.userId,
          reservationId: input.reservationId,
          characters: input.chars,
          remaining: input.limit - counter.reservedChars,
        },
        'quota.debited',
      );
      return 'reserved';
    }

    // Limite dépassée : on retire la trace, rien n'est débité.
    await db
      .delete(quotaReservations)
      .where(eq(quotaReservations.reservationId, input.reservationId));
    return 'exceeded';
  }

  async refund(reservationId: string, chars: number, at: Date, tx?: unknown): Promise<boolean> {
    const db = this.client(tx);
    const refunded = await db
      .update(quotaReservations)
      .set({ refundedChars: sql`least(${quotaReservations.chars}, ${chars})`, refundedAt: at })
      .where(
        and(
          eq(quotaReservations.reservationId, reservationId),
          isNull(quotaReservations.refundedAt),
        ),
      )
      .returning({
        userId: quotaReservations.userId,
        period: quotaReservations.period,
        refundedChars: quotaReservations.refundedChars,
      });
    const row = refunded.at(0);
    if (row === undefined) return false;
    // Remboursement = action sensible : trace d'audit (observability.md).
    this.logger.log(
      {
        audit: true,
        actor: 'system',
        action: 'quota.refunded',
        target: reservationId,
        result: 'ok',
        userId: row.userId,
        characters: row.refundedChars,
      },
      'quota.refunded',
    );
    await db
      .update(quotaUsage)
      .set({
        reservedChars: sql`greatest(${quotaUsage.reservedChars} - ${row.refundedChars ?? 0}, 0)`,
        updatedAt: at,
      })
      .where(and(eq(quotaUsage.userId, row.userId), eq(quotaUsage.period, row.period)));
    return true;
  }

  async usage(userId: string, period: QuotaPeriod): Promise<number> {
    const rows = await this.db
      .select({ reservedChars: quotaUsage.reservedChars })
      .from(quotaUsage)
      .where(and(eq(quotaUsage.userId, userId), eq(quotaUsage.period, period)))
      .limit(1);
    return rows.at(0)?.reservedChars ?? 0;
  }

  /**
   * Transaction ambiante (fournie par le `UnitOfWork`) ou connexion par
   * défaut. Invariant : le `TxContext` opaque est toujours une transaction
   * Drizzle, qui expose la même API de requêtes que le client.
   */
  private client(tx?: unknown): DrizzleClient {
    return (tx as DrizzleClient | undefined) ?? this.db;
  }
}
