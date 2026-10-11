import { type CreditEntryKind } from '@/modules/billing/domain/credit-entry';
import { type Offer } from '@/modules/billing/domain/offer';
import { isPassActiveAt, remainingPassUnits } from '@/modules/billing/domain/pass';
import { type OfferCatalogPort } from '@/modules/billing/domain/ports/offer-catalog.port';
import {
  type GrantedPurchase,
  type PurchaseLedgerPort,
} from '@/modules/billing/domain/ports/purchase-ledger.port';
import {
  type AccountBalances,
  type LockedBalances,
  type UnitsLedgerPort,
  type UnitsReservation,
} from '@/modules/billing/domain/ports/units-ledger.port';
import {
  type WalletEntry,
  type WalletEntryPosition,
  type WalletHistoryPort,
} from '@/modules/billing/domain/ports/wallet-history.port';
import { type UnitsBySource } from '@/modules/billing/domain/services/allocation';
import { Money } from '@/modules/billing/domain/value-objects/money.vo';
import { type QuotaPeriod } from '@/modules/billing/domain/value-objects/quota-period.vo';
import { Units } from '@/modules/billing/domain/value-objects/units.vo';

interface StoredPass {
  readonly id: string;
  readonly userId: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly includedUnits: Units;
  usedUnits: number;
}

/** Catalogue de l'ADR-0019 (valeurs provisoires de la migration). */
export const DEFAULT_OFFERS: readonly Offer[] = [
  {
    code: 'pass-30d',
    kind: 'pass',
    price: Money.xaf(2000),
    units: Units.of(250_000),
    durationDays: 30,
    active: true,
  },
  {
    code: 'credits-s',
    kind: 'credits',
    price: Money.xaf(500),
    units: Units.of(50_000),
    active: true,
  },
  {
    code: 'credits-m',
    kind: 'credits',
    price: Money.xaf(1000),
    units: Units.of(110_000),
    active: true,
  },
  {
    code: 'credits-l',
    kind: 'credits',
    price: Money.xaf(2500),
    units: Units.of(300_000),
    active: true,
  },
];

/**
 * Fake des quatre ports de `billing` (mêmes règles que les adapters SQL, en
 * mémoire). Une seule classe : réservations et achats partagent le
 * portefeuille et les pass.
 */
export class InMemoryBilling
  implements UnitsLedgerPort, PurchaseLedgerPort, OfferCatalogPort, WalletHistoryPort
{
  readonly freeUsed = new Map<string, number>();
  readonly reservations = new Map<string, UnitsReservation>();
  readonly passes: StoredPass[] = [];
  readonly wallets = new Map<string, number>();
  readonly purchases = new Map<string, GrantedPurchase>();
  readonly entries: (WalletEntry & { readonly userId: string })[] = [];
  private sequence = 0;

  constructor(private readonly offers: readonly Offer[] = DEFAULT_OFFERS) {}

  // --- UnitsLedgerPort ---------------------------------------------------------

  findReservation(reservationId: string): Promise<UnitsReservation | null> {
    return Promise.resolve(this.reservations.get(reservationId) ?? null);
  }

  lockBalances(userId: string, period: QuotaPeriod, at: Date): Promise<LockedBalances> {
    const pass = this.activePass(userId, at);
    return Promise.resolve({
      freeUsed: Units.of(this.freeUsed.get(`${userId}|${period}`) ?? 0),
      activePass:
        pass === undefined
          ? null
          : {
              id: pass.id,
              remaining: remainingPassUnits({ ...pass, usedUnits: Units.of(pass.usedUnits) }),
            },
      credits: Units.of(this.wallets.get(userId) ?? 0),
    });
  }

  recordReservation(reservation: Omit<UnitsReservation, 'refunded'>, at: Date): Promise<void> {
    this.reservations.set(reservation.reservationId, { ...reservation, refunded: false });
    this.move(reservation, reservation.taken, -1, 'consumption', at);
    return Promise.resolve();
  }

  recordRefund(
    reservation: UnitsReservation,
    refund: UnitsBySource,
    _refundedChars: number,
    at: Date,
  ): Promise<boolean> {
    const stored = this.reservations.get(reservation.reservationId);
    if (stored === undefined || stored.refunded) return Promise.resolve(false);
    this.reservations.set(reservation.reservationId, { ...stored, refunded: true });
    this.move(stored, refund, 1, 'refund', at);
    return Promise.resolve(true);
  }

  balances(userId: string, period: QuotaPeriod, at: Date): Promise<AccountBalances> {
    const pass = this.activePass(userId, at);
    const next = this.passes
      .filter((p) => p.userId === userId && p.startsAt.getTime() > at.getTime())
      .toSorted((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
      .at(0);
    return Promise.resolve({
      freeUsed: Units.of(this.freeUsed.get(`${userId}|${period}`) ?? 0),
      currentPass:
        pass === undefined
          ? null
          : {
              endsAt: pass.endsAt,
              includedUnits: pass.includedUnits,
              usedUnits: Units.of(pass.usedUnits),
            },
      nextPassStartsAt: next?.startsAt ?? null,
      credits: Units.of(this.wallets.get(userId) ?? 0),
    });
  }

  // --- PurchaseLedgerPort ------------------------------------------------------

  findPurchase(paymentReference: string): Promise<GrantedPurchase | null> {
    return Promise.resolve(this.purchases.get(paymentReference) ?? null);
  }

  lockForPurchase(userId: string, _at: Date): Promise<Date | null> {
    const ends = this.passes.filter((p) => p.userId === userId).map((p) => p.endsAt.getTime());
    return Promise.resolve(ends.length === 0 ? null : new Date(Math.max(...ends)));
  }

  recordPurchase(purchase: GrantedPurchase, at: Date): Promise<boolean> {
    if (this.purchases.has(purchase.paymentReference)) return Promise.resolve(false);
    this.purchases.set(purchase.paymentReference, purchase);
    const { grant } = purchase;
    if (grant.kind === 'pass') {
      this.passes.push({
        id: `pass-${String(++this.sequence)}`,
        userId: purchase.userId,
        startsAt: grant.startsAt,
        endsAt: grant.endsAt,
        includedUnits: grant.units,
        usedUnits: 0,
      });
    } else {
      this.wallets.set(purchase.userId, (this.wallets.get(purchase.userId) ?? 0) + grant.units);
      this.entry(purchase.userId, 'purchase', grant.units, at, grant.offerCode, null);
    }
    return Promise.resolve(true);
  }

  // --- OfferCatalogPort --------------------------------------------------------

  findByCode(code: string): Promise<Offer | null> {
    return Promise.resolve(this.offers.find((o) => o.code === code) ?? null);
  }

  listActive(): Promise<readonly Offer[]> {
    return Promise.resolve(this.offers.filter((o) => o.active));
  }

  // --- WalletHistoryPort -------------------------------------------------------

  listEntries(
    userId: string,
    after: WalletEntryPosition | null,
    limit: number,
  ): Promise<readonly WalletEntry[]> {
    const rows = this.entries
      .filter((e) => e.userId === userId)
      .toSorted((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id))
      .filter(
        (e) =>
          after === null ||
          e.createdAt.getTime() < after.createdAt.getTime() ||
          (e.createdAt.getTime() === after.createdAt.getTime() && e.id < after.id),
      )
      .slice(0, limit)
      .map(({ userId: _owner, ...entry }) => entry);
    return Promise.resolve(rows);
  }

  // --- interne -----------------------------------------------------------------

  private activePass(userId: string, at: Date): StoredPass | undefined {
    return this.passes.find((p) => p.userId === userId && isPassActiveAt(p, at));
  }

  /** Applique `units` (signe `sign`) à chaque source d'une réservation. */
  private move(
    reservation: Omit<UnitsReservation, 'refunded'>,
    units: UnitsBySource,
    sign: 1 | -1,
    kind: CreditEntryKind,
    at: Date,
  ): void {
    const key = `${reservation.userId}|${reservation.period}`;
    this.freeUsed.set(key, Math.max(0, (this.freeUsed.get(key) ?? 0) - sign * units.free));
    const debited = this.passes.find((p) => p.id === reservation.passId);
    if (debited !== undefined) {
      debited.usedUnits = Math.max(0, debited.usedUnits - sign * units.pass);
    }
    if (units.credits > 0) {
      const balance = this.wallets.get(reservation.userId) ?? 0;
      this.wallets.set(reservation.userId, balance + sign * units.credits);
      this.entry(
        reservation.userId,
        kind,
        sign * units.credits,
        at,
        null,
        reservation.reservationId,
      );
    }
  }

  private entry(
    userId: string,
    kind: CreditEntryKind,
    units: number,
    createdAt: Date,
    offerCode: string | null,
    reservationId: string | null,
  ): void {
    this.entries.push({
      id: `entry-${String(++this.sequence).padStart(6, '0')}`,
      userId,
      kind,
      units,
      createdAt,
      offerCode,
      reservationId,
    });
  }
}
