import { startMigratedPostgres, type StartedPostgres } from '../../../../../test/support';
import { user } from '../../../identity/infrastructure/persistence/schema/auth.schema';
import { QuotaPeriod } from '../../domain/value-objects/quota-period.vo';

import { DrizzleQuotaLedger } from './quota-ledger.drizzle-repository';

const AT = new Date('2026-10-06T10:00:00Z');
const PERIOD = QuotaPeriod.at(AT);
const reservation = (id: number) => `01a11019-f2e7-7014-8369-${String(id).padStart(12, '0')}`;

/**
 * Contre un vrai Postgres : l'incrément conditionnel est atomique (aucun
 * dépassement sous des réservations simultanées), réservation et
 * remboursement sont idempotents.
 */
describe('DrizzleQuotaLedger (integration, Testcontainers)', () => {
  let pg: StartedPostgres;
  let ledger: DrizzleQuotaLedger;

  beforeAll(async () => {
    pg = await startMigratedPostgres();
    ledger = new DrizzleQuotaLedger(pg.db);
    await pg.db.insert(user).values([{ id: 'alice', name: 'Alice', email: 'alice@x.cm' }]);
  }, 120_000);

  afterAll(async () => {
    await pg.stop();
  });

  beforeEach(async () => {
    await pg.sql`delete from quota_reservations`;
    await pg.sql`delete from quota_usage`;
  });

  const reserve = (id: number, chars: number, limit = 1000) =>
    ledger.reserve({
      reservationId: reservation(id),
      userId: 'alice',
      period: PERIOD,
      chars,
      limit,
      at: AT,
    });

  it('reserves, refuses beyond the limit without writing anything, and is idempotent', async () => {
    expect(await reserve(1, 600)).toBe('reserved');
    expect(await reserve(1, 600)).toBe('already_reserved');
    expect(await reserve(2, 500)).toBe('exceeded');
    expect(await ledger.usage('alice', PERIOD)).toBe(600);
    const [{ count }] = await pg.sql<{ count: string }[]>`select count(*) from quota_reservations`;
    expect(Number(count)).toBe(1);
  });

  it('never exceeds the limit under concurrent reservations', async () => {
    const outcomes = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        pg.db.transaction((tx) =>
          ledger.reserve(
            {
              reservationId: reservation(10 + i),
              userId: 'alice',
              period: PERIOD,
              chars: 300,
              limit: 1000,
              at: AT,
            },
            tx,
          ),
        ),
      ),
    );
    expect(outcomes.filter((o) => o === 'reserved')).toHaveLength(3);
    expect(await ledger.usage('alice', PERIOD)).toBe(900);
  });

  it('refunds once, at most what was reserved', async () => {
    await reserve(1, 600);
    expect(await ledger.refund(reservation(1), 10_000, AT)).toBe(true);
    expect(await ledger.refund(reservation(1), 100, AT)).toBe(false);
    expect(await ledger.refund(reservation(99), 100, AT)).toBe(false);
    expect(await ledger.usage('alice', PERIOD)).toBe(0);
    // SQL brut : postgres-js renvoie un bigint en chaîne (Drizzle le convertit, lui).
    const [row] = await pg.sql<{ refunded_chars: string }[]>`
      select refunded_chars from quota_reservations where reservation_id = ${reservation(1)}`;
    expect(Number(row.refunded_chars)).toBe(600);
  });

  it('counts each month separately', async () => {
    await reserve(1, 600);
    expect(await ledger.usage('alice', QuotaPeriod.at(new Date('2026-11-01T00:00:00Z')))).toBe(0);
  });
});
