import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, eq, gt, isNull, lte, min, sql } from 'drizzle-orm';

import { uuidV7 } from '@/shared/kernel';
import { DRIZZLE_CLIENT, type DrizzleClient } from '@/shared/persistence';

import {
  type AccountBalances,
  type LockedBalances,
  type UnitsLedgerPort,
  type UnitsReservation,
} from '../../domain/ports/units-ledger.port';
import { type UnitsBySource } from '../../domain/services/allocation';
import { type QuotaPeriod } from '../../domain/value-objects/quota-period.vo';
import { Units, type VoiceTier } from '../../domain/value-objects/units.vo';

import {
  creditEntries,
  passes,
  quotaReservations,
  quotaUsage,
  wallets,
} from './schema/billing.schema';

/**
 * Compteurs d'unités en SQL (ADR-0010, ADR-0019). Les verrous sont pris
 * toujours dans le même ordre — compteur gratuit → pass → portefeuille —
 * par la réservation comme par le remboursement : ni course, ni
 * interblocage.
 */
@Injectable()
export class DrizzleUnitsLedger implements UnitsLedgerPort {
  private readonly logger = new Logger(DrizzleUnitsLedger.name);

  constructor(@Inject(DRIZZLE_CLIENT) private readonly db: DrizzleClient) {}

  async findReservation(
    reservationId: string,
    tx: unknown,
    options?: { readonly lock: boolean },
  ): Promise<UnitsReservation | null> {
    const query = this.client(tx)
      .select()
      .from(quotaReservations)
      .where(eq(quotaReservations.reservationId, reservationId))
      .limit(1);
    const rows = options?.lock === true ? await query.for('update') : await query;
    const row = rows.at(0);
    if (row === undefined) return null;
    return {
      reservationId: row.reservationId,
      userId: row.userId,
      period: row.period as QuotaPeriod,
      // Invariant : contrainte `quota_reservations_tier_check`.
      tier: row.tier as VoiceTier,
      chars: row.chars,
      passId: row.passId,
      taken: {
        free: Units.of(row.freeUnits),
        pass: Units.of(row.passUnits),
        credits: Units.of(row.creditUnits),
      },
      refunded: row.refundedAt !== null,
    };
  }

  async lockBalances(
    userId: string,
    period: QuotaPeriod,
    at: Date,
    tx: unknown,
  ): Promise<LockedBalances> {
    const db = this.client(tx);
    // Lignes créées vides au besoin : `FOR UPDATE` ne verrouille que l'existant.
    await db
      .insert(quotaUsage)
      .values({ userId, period, reservedChars: 0, updatedAt: at })
      .onConflictDoNothing();
    const free = await db
      .select({ used: quotaUsage.reservedChars })
      .from(quotaUsage)
      .where(and(eq(quotaUsage.userId, userId), eq(quotaUsage.period, period)))
      .for('update');
    const pass = await db
      .select({ id: passes.id, included: passes.includedUnits, used: passes.usedUnits })
      .from(passes)
      .where(and(eq(passes.userId, userId), lte(passes.startsAt, at), gt(passes.endsAt, at)))
      .orderBy(asc(passes.startsAt))
      .limit(1)
      .for('update');
    await db
      .insert(wallets)
      .values({ userId, balanceUnits: 0, updatedAt: at })
      .onConflictDoNothing();
    const wallet = await db
      .select({ balance: wallets.balanceUnits })
      .from(wallets)
      .where(eq(wallets.userId, userId))
      .for('update');

    const activePass = pass.at(0);
    return {
      freeUsed: Units.of(free.at(0)?.used ?? 0),
      activePass:
        activePass === undefined
          ? null
          : {
              id: activePass.id,
              remaining: Units.of(Math.max(0, activePass.included - activePass.used)),
            },
      credits: Units.of(wallet.at(0)?.balance ?? 0),
    };
  }

  async recordReservation(
    reservation: Omit<UnitsReservation, 'refunded'>,
    at: Date,
    tx: unknown,
  ): Promise<void> {
    const db = this.client(tx);
    const { taken } = reservation;
    await db.insert(quotaReservations).values({
      reservationId: reservation.reservationId,
      userId: reservation.userId,
      period: reservation.period,
      chars: reservation.chars,
      tier: reservation.tier,
      passId: reservation.passId,
      freeUnits: taken.free,
      passUnits: taken.pass,
      creditUnits: taken.credits,
      createdAt: at,
    });
    await this.applyToSources(db, reservation, taken, -1, at);
    // Log comptable (observability.md) : identifiants, jamais de PII.
    this.logger.log(
      {
        userId: reservation.userId,
        reservationId: reservation.reservationId,
        characters: reservation.chars,
        tier: reservation.tier,
        units: taken,
      },
      'quota.debited',
    );
  }

  async recordRefund(
    reservation: UnitsReservation,
    refund: UnitsBySource,
    refundedChars: number,
    at: Date,
    tx: unknown,
  ): Promise<boolean> {
    const db = this.client(tx);
    const marked = await db
      .update(quotaReservations)
      .set({ refundedChars, refundedAt: at })
      .where(
        and(
          eq(quotaReservations.reservationId, reservation.reservationId),
          isNull(quotaReservations.refundedAt),
        ),
      )
      .returning({ id: quotaReservations.reservationId });
    if (marked.length === 0) return false;
    await this.applyToSources(db, reservation, refund, 1, at);
    // Remboursement = action sensible : trace d'audit (observability.md).
    this.logger.log(
      {
        audit: true,
        actor: 'system',
        action: 'quota.refunded',
        target: reservation.reservationId,
        result: 'ok',
        userId: reservation.userId,
        characters: refundedChars,
        units: refund,
      },
      'quota.refunded',
    );
    return true;
  }

  async balances(userId: string, period: QuotaPeriod, at: Date): Promise<AccountBalances> {
    const [free, current, next, wallet] = await Promise.all([
      this.db
        .select({ used: quotaUsage.reservedChars })
        .from(quotaUsage)
        .where(and(eq(quotaUsage.userId, userId), eq(quotaUsage.period, period)))
        .limit(1),
      this.db
        .select({
          endsAt: passes.endsAt,
          included: passes.includedUnits,
          used: passes.usedUnits,
        })
        .from(passes)
        .where(and(eq(passes.userId, userId), lte(passes.startsAt, at), gt(passes.endsAt, at)))
        .orderBy(asc(passes.startsAt))
        .limit(1),
      this.db
        .select({ startsAt: min(passes.startsAt) })
        .from(passes)
        .where(and(eq(passes.userId, userId), gt(passes.startsAt, at))),
      this.db
        .select({ balance: wallets.balanceUnits })
        .from(wallets)
        .where(eq(wallets.userId, userId))
        .limit(1),
    ]);
    const pass = current.at(0);
    return {
      freeUsed: Units.of(free.at(0)?.used ?? 0),
      currentPass:
        pass === undefined
          ? null
          : {
              endsAt: pass.endsAt,
              includedUnits: Units.of(pass.included),
              usedUnits: Units.of(pass.used),
            },
      nextPassStartsAt: next.at(0)?.startsAt ?? null,
      credits: Units.of(wallet.at(0)?.balance ?? 0),
    };
  }

  /**
   * Débite (`sign = -1`) ou rend (`sign = 1`) à chaque source sa part, dans
   * l'ordre des verrous. Les crédits laissent une ligne au journal.
   */
  private async applyToSources(
    db: DrizzleClient,
    reservation: Omit<UnitsReservation, 'refunded'>,
    units: UnitsBySource,
    sign: 1 | -1,
    at: Date,
  ): Promise<void> {
    if (units.free > 0) {
      await db
        .update(quotaUsage)
        .set({
          reservedChars: sql`greatest(${quotaUsage.reservedChars} - ${sign * units.free}, 0)`,
          updatedAt: at,
        })
        .where(
          and(eq(quotaUsage.userId, reservation.userId), eq(quotaUsage.period, reservation.period)),
        );
    }
    if (units.pass > 0 && reservation.passId !== null) {
      await db
        .update(passes)
        .set({ usedUnits: sql`greatest(${passes.usedUnits} - ${sign * units.pass}, 0)` })
        .where(eq(passes.id, reservation.passId));
    }
    if (units.credits > 0) {
      await db
        .update(wallets)
        .set({
          balanceUnits: sql`${wallets.balanceUnits} + ${sign * units.credits}`,
          updatedAt: at,
        })
        .where(eq(wallets.userId, reservation.userId));
      await db.insert(creditEntries).values({
        id: uuidV7(),
        userId: reservation.userId,
        kind: sign < 0 ? 'consumption' : 'refund',
        units: sign * units.credits,
        reservationId: reservation.reservationId,
        createdAt: at,
      });
    }
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
