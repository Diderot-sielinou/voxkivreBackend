import { DrizzleUnitOfWork } from '@/shared/persistence/drizzle-unit-of-work';

import { startMigratedPostgres, type StartedPostgres } from '../../../../../test/support';
import { FixedClock } from '../../../../../test/support/fakes';
import { user } from '../../../identity/infrastructure/persistence/schema/auth.schema';
import { GetBillingAccountUseCase } from '../../application/use-cases/get-billing-account.use-case';
import { GrantOfferUseCase } from '../../application/use-cases/grant-offer.use-case';
import { RefundQuotaUseCase } from '../../application/use-cases/refund-quota.use-case';
import { ReserveQuotaUseCase } from '../../application/use-cases/reserve-quota.use-case';

import { DrizzleOfferCatalog } from './offer-catalog.drizzle-repository';
import { DrizzlePurchaseLedger } from './purchase-ledger.drizzle-repository';
import { DrizzleUnitsLedger } from './units-ledger.drizzle-repository';
import { DrizzleWalletHistory } from './wallet-history.drizzle-repository';

const AT = new Date('2026-10-10T10:00:00Z');
const reservation = (id: number) => `01a11019-f2e7-7014-8369-${String(id).padStart(12, '0')}`;

/**
 * Contre un vrai Postgres (migrations 0009 + 0010 comprises) : répartition
 * entre les trois sources, remboursement, verrous sous concurrence, octroi
 * idempotent, catalogue et historique.
 */
describe('billing Drizzle adapters (integration, Testcontainers)', () => {
  let pg: StartedPostgres;

  beforeAll(async () => {
    pg = await startMigratedPostgres();
    await pg.db.insert(user).values([{ id: 'alice', name: 'Alice', email: 'alice@x.cm' }]);
  }, 120_000);

  afterAll(async () => {
    await pg.stop();
  });

  beforeEach(async () => {
    await pg.sql`delete from credit_entries`;
    await pg.sql`delete from passes`;
    await pg.sql`delete from purchases`;
    await pg.sql`delete from wallets`;
    await pg.sql`delete from quota_reservations`;
    await pg.sql`delete from quota_usage`;
  });

  function setup(freeTier = 1000) {
    const units = new DrizzleUnitsLedger(pg.db);
    const purchases = new DrizzlePurchaseLedger(pg.db);
    const catalog = new DrizzleOfferCatalog(pg.db);
    const uow = new DrizzleUnitOfWork(pg.db);
    const clock = new FixedClock(AT);
    const policy = { freeTierUnitsPerMonth: freeTier, maxCharsPerConversion: 1_000_000 };
    return {
      catalog,
      history: new DrizzleWalletHistory(pg.db),
      reserve: new ReserveQuotaUseCase(units, policy, uow, clock),
      refund: new RefundQuotaUseCase(units, uow, clock),
      grant: new GrantOfferUseCase(catalog, purchases, uow, clock),
      account: new GetBillingAccountUseCase(units, policy, clock),
    };
  }

  it('reads the catalogue seeded by the migration, pass first', async () => {
    const { catalog } = setup();
    const offers = await catalog.listActive();
    expect(offers.map((o) => [o.code, o.price, o.units])).toEqual([
      ['pass-30d', 2000, 250_000],
      ['credits-s', 500, 50_000],
      ['credits-m', 1000, 110_000],
      ['credits-l', 2500, 300_000],
    ]);
    expect(await catalog.findByCode('pass-30d')).toMatchObject({ kind: 'pass', durationDays: 30 });
    expect(await catalog.findByCode('nope')).toBeNull();
  });

  it('spills free → pass → credits, refunds credits → pass → free, once', async () => {
    const { reserve, refund, grant, account, history } = setup();
    await grant.execute({ userId: 'alice', offerCode: 'pass-30d', paymentReference: 'pay-1' });
    await grant.execute({ userId: 'alice', offerCode: 'credits-s', paymentReference: 'pay-2' });

    const reserved = await reserve.execute({
      reservationId: reservation(1),
      userId: 'alice',
      chars: 251_500,
      tier: 'standard',
    });
    expect(reserved.value.taken).toEqual({ free: 1000, pass: 250_000, credits: 500 });
    expect(await account.execute('alice')).toMatchObject({
      free: { used: 1000 },
      pass: { usedUnits: 250_000 },
      credits: 49_500,
    });

    expect(await refund.execute(reservation(1), 1000)).toBe(true);
    expect(await refund.execute(reservation(1), 1000)).toBe(false);
    expect(await account.execute('alice')).toMatchObject({
      free: { used: 1000 },
      pass: { usedUnits: 249_500 },
      credits: 50_000,
    });
    const entries = await history.listEntries('alice', null, 10);
    expect(entries.map((e) => [e.kind, e.units])).toEqual([
      ['refund', 500],
      ['consumption', -500],
      ['purchase', 50_000],
    ]);
  });

  it('debits an operation once, and refuses without writing anything', async () => {
    const { reserve, account } = setup();
    const input = {
      reservationId: reservation(1),
      userId: 'alice',
      chars: 600,
      tier: 'standard',
    } as const;
    await reserve.execute(input);
    const again = await reserve.execute(input);
    expect(again.isOk()).toBe(true);
    const refused = await reserve.execute({ ...input, reservationId: reservation(2) });
    expect(refused.error.code).toBe('QUOTA_EXCEEDED');
    expect(await account.execute('alice')).toMatchObject({ free: { used: 600 } });
    const [{ count }] = await pg.sql<{ count: string }[]>`select count(*) from quota_reservations`;
    expect(Number(count)).toBe(1);
  });

  it('never overspends the wallet under concurrent reservations', async () => {
    const { reserve, grant, account } = setup(0);
    await grant.execute({ userId: 'alice', offerCode: 'credits-s', paymentReference: 'pay-1' });
    // 10 conversions de 6 000 unités pour 50 000 de crédits : 8 passent au plus.
    const outcomes = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        reserve.execute({
          reservationId: reservation(10 + i),
          userId: 'alice',
          chars: 1500,
          tier: 'natural',
        }),
      ),
    );
    const accepted = outcomes.filter((o) => o.isOk()).length;
    expect(accepted).toBe(8);
    expect(await account.execute('alice')).toMatchObject({ credits: 50_000 - 8 * 6000 });
  });

  it('grants a payment once, and chains concurrent passes without overlap', async () => {
    const { grant, account } = setup();
    const results = await Promise.all(
      ['pay-1', 'pay-2', 'pay-1'].map((ref) =>
        grant.execute({ userId: 'alice', offerCode: 'pass-30d', paymentReference: ref }),
      ),
    );
    expect(results.filter((r) => r.isOk() && r.value.granted)).toHaveLength(2);
    const rows = await pg.sql<
      { starts_at: string; ends_at: string }[]
    >`select starts_at::text, ends_at::text from passes order by starts_at`;
    expect(rows).toHaveLength(2);
    const firstEnd = new Date(rows[0].ends_at);
    expect(new Date(rows[1].starts_at)).toEqual(firstEnd);
    expect(await account.execute('alice')).toMatchObject({
      pass: { includedUnits: 250_000 },
      nextPassStartsAt: firstEnd,
    });
  });
});
