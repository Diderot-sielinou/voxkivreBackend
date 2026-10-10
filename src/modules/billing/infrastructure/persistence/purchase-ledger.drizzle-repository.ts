import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq, max, sql } from 'drizzle-orm';

import { uuidV7 } from '@/shared/kernel';
import { DRIZZLE_CLIENT, type DrizzleClient } from '@/shared/persistence';

import {
  type GrantedPurchase,
  type PurchaseLedgerPort,
} from '../../domain/ports/purchase-ledger.port';
import { Money } from '../../domain/value-objects/money.vo';
import { Units } from '../../domain/value-objects/units.vo';

import { creditEntries, passes, purchases, wallets } from './schema/billing.schema';

/** Achats accordés en SQL (ADR-0019 §9) ; la référence de paiement est la clé primaire. */
@Injectable()
export class DrizzlePurchaseLedger implements PurchaseLedgerPort {
  private readonly logger = new Logger(DrizzlePurchaseLedger.name);

  constructor(@Inject(DRIZZLE_CLIENT) private readonly db: DrizzleClient) {}

  async findPurchase(paymentReference: string, tx: unknown): Promise<GrantedPurchase | null> {
    const rows = await this.client(tx)
      .select({
        paymentReference: purchases.paymentReference,
        userId: purchases.userId,
        offerCode: purchases.offerCode,
        kind: purchases.kind,
        priceXaf: purchases.priceXaf,
        units: purchases.units,
        startsAt: passes.startsAt,
        endsAt: passes.endsAt,
      })
      .from(purchases)
      .leftJoin(passes, eq(passes.paymentReference, purchases.paymentReference))
      .where(eq(purchases.paymentReference, paymentReference))
      .limit(1);
    const row = rows.at(0);
    if (row === undefined) return null;
    const common = {
      offerCode: row.offerCode,
      price: Money.xaf(row.priceXaf),
      units: Units.of(row.units),
    };
    return {
      paymentReference: row.paymentReference,
      userId: row.userId,
      grant:
        row.kind === 'pass' && row.startsAt !== null && row.endsAt !== null
          ? { kind: 'pass', ...common, startsAt: row.startsAt, endsAt: row.endsAt }
          : { kind: 'credits', ...common },
    };
  }

  async lockForPurchase(userId: string, at: Date, tx: unknown): Promise<Date | null> {
    const db = this.client(tx);
    // Le portefeuille sert de verrou par utilisateur (créé vide au besoin).
    await db
      .insert(wallets)
      .values({ userId, balanceUnits: 0, updatedAt: at })
      .onConflictDoNothing();
    await db
      .select({ userId: wallets.userId })
      .from(wallets)
      .where(eq(wallets.userId, userId))
      .for('update');
    const latest = await db
      .select({ endsAt: max(passes.endsAt) })
      .from(passes)
      .where(eq(passes.userId, userId));
    return latest.at(0)?.endsAt ?? null;
  }

  async recordPurchase(purchase: GrantedPurchase, at: Date, tx: unknown): Promise<boolean> {
    const db = this.client(tx);
    const { grant } = purchase;
    const inserted = await db
      .insert(purchases)
      .values({
        paymentReference: purchase.paymentReference,
        userId: purchase.userId,
        offerCode: grant.offerCode,
        kind: grant.kind,
        priceXaf: grant.price,
        units: grant.units,
        grantedAt: at,
      })
      .onConflictDoNothing({ target: purchases.paymentReference })
      .returning({ ref: purchases.paymentReference });
    // Référence accordée entre-temps par une requête concurrente : rien d'autre.
    if (inserted.length === 0) return false;
    if (grant.kind === 'pass') {
      await db.insert(passes).values({
        id: uuidV7(),
        userId: purchase.userId,
        paymentReference: purchase.paymentReference,
        offerCode: grant.offerCode,
        startsAt: grant.startsAt,
        endsAt: grant.endsAt,
        includedUnits: grant.units,
      });
    } else {
      await db
        .update(wallets)
        .set({ balanceUnits: sql`${wallets.balanceUnits} + ${grant.units}`, updatedAt: at })
        .where(eq(wallets.userId, purchase.userId));
      await db.insert(creditEntries).values({
        id: uuidV7(),
        userId: purchase.userId,
        kind: 'purchase',
        units: grant.units,
        offerCode: grant.offerCode,
        createdAt: at,
      });
    }
    // Droits accordés contre paiement : trace d'audit (observability.md).
    this.logger.log(
      {
        audit: true,
        actor: 'system',
        action: 'billing.granted',
        target: purchase.paymentReference,
        result: 'ok',
        userId: purchase.userId,
        offerCode: grant.offerCode,
        units: grant.units,
        priceXaf: grant.price,
      },
      'billing.granted',
    );
    return true;
  }

  /** Invariant : le `TxContext` opaque est toujours une transaction Drizzle. */
  private client(tx?: unknown): DrizzleClient {
    return (tx as DrizzleClient | undefined) ?? this.db;
  }
}
