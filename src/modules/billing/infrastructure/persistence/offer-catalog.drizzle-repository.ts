import { Inject, Injectable } from '@nestjs/common';
import { asc, eq, sql } from 'drizzle-orm';

import { DRIZZLE_CLIENT, type DrizzleClient } from '@/shared/persistence';

import { type Offer } from '../../domain/offer';
import { type OfferCatalogPort } from '../../domain/ports/offer-catalog.port';
import { Money } from '../../domain/value-objects/money.vo';
import { Units } from '../../domain/value-objects/units.vo';

import { offers } from './schema/billing.schema';

type OfferRow = typeof offers.$inferSelect;

/** Catalogue lu dans `offers` (ADR-0019 §7). Quelques lignes : pas de cache. */
@Injectable()
export class DrizzleOfferCatalog implements OfferCatalogPort {
  constructor(@Inject(DRIZZLE_CLIENT) private readonly db: DrizzleClient) {}

  async findByCode(code: string): Promise<Offer | null> {
    const rows = await this.db.select().from(offers).where(eq(offers.code, code)).limit(1);
    const row = rows.at(0);
    return row === undefined ? null : toOffer(row);
  }

  async listActive(): Promise<readonly Offer[]> {
    const rows = await this.db
      .select()
      .from(offers)
      .where(eq(offers.active, true))
      .orderBy(sql`${offers.kind} <> 'pass'`, asc(offers.priceXaf));
    return rows.map((row) => toOffer(row));
  }
}

function toOffer(row: OfferRow): Offer {
  const common = {
    code: row.code,
    price: Money.xaf(row.priceXaf),
    units: Units.of(row.units),
    active: row.active,
  };
  // Invariant : `offers_duration_check` impose une durée à un pass, et à lui seul.
  return row.kind === 'pass'
    ? { ...common, kind: 'pass', durationDays: row.durationDays ?? 0 }
    : { ...common, kind: 'credits' };
}
