import { startMigratedPostgres, type StartedPostgres } from '../../../../../test/support';
import { user } from '../../../identity/infrastructure/persistence/schema/auth.schema';
import { newPendingPayment, type Payment } from '../../domain/entities/payment.entity';
import { attemptWindows } from '../../domain/services/payment-policy';

import { DrizzlePaymentRepository } from './payment.drizzle-repository';
import { payments } from './schema/payment.schema';

const NOW = new Date('2026-10-11T12:00:00Z');
const minutesAgo = (n: number) => new Date(NOW.getTime() - n * 60_000);
const PHONE_A = 'a'.repeat(64);
const PHONE_B = 'b'.repeat(64);

let sequence = 0;

/** Paiement `pending` d'un utilisateur, identifiants uniques à chaque appel. */
function pending(overrides: Partial<Payment> & { readonly createdAt?: Date } = {}): Payment {
  sequence += 1;
  const n = String(sequence).padStart(12, '0');
  const createdAt = overrides.createdAt ?? NOW;
  return {
    ...newPendingPayment({
      id: `01a11019-f2e7-7014-8369-${n}`,
      userId: 'alice',
      offerCode: 'pass-30d',
      amountXaf: 2000,
      idempotencyKey: `key-${n}`,
      requestHash: 'c'.repeat(64),
      provider: 'campay',
      externalReference: `2ceefe04-1a79-4914-9dd0-${n}`,
      phoneHmac: PHONE_A,
      phoneSuffix: '12',
      now: createdAt,
    }),
    ...overrides,
  };
}

/** Contre un vrai Postgres migré (0011) : idempotence, comptages, transitions conditionnelles. */
describe('DrizzlePaymentRepository (integration, Testcontainers)', () => {
  let pg: StartedPostgres;
  let repository: DrizzlePaymentRepository;

  beforeAll(async () => {
    pg = await startMigratedPostgres();
    repository = new DrizzlePaymentRepository(pg.db);
    await pg.db.insert(user).values([
      { id: 'alice', name: 'Alice', email: 'alice@x.cm' },
      { id: 'bob', name: 'Bob', email: 'bob@x.cm' },
    ]);
  }, 120_000);

  afterAll(async () => {
    await pg.stop();
  });

  beforeEach(async () => {
    await pg.db.delete(payments);
  });

  it('round-trips a payment, and finds it by every lookup', async () => {
    const payment = pending();
    expect(await repository.insert(payment)).toBe(true);
    expect(await repository.attachProviderReference(payment.id, 'campay-ref', NOW)).toBe(true);
    const stored = { ...payment, providerReference: 'campay-ref' };

    expect(await repository.findByIdForUser(payment.id, 'alice')).toStrictEqual(stored);
    expect(await repository.findByIdempotencyKey('alice', payment.idempotencyKey)).toStrictEqual(
      stored,
    );
    expect(await repository.findByProviderReference('campay', 'campay-ref')).toStrictEqual(stored);
    expect(await repository.findByExternalReference(payment.externalReference)).toStrictEqual(
      stored,
    );
  });

  it('hides a payment from another user (RNF-08)', async () => {
    const payment = pending();
    await repository.insert(payment);
    expect(await repository.findByIdForUser(payment.id, 'bob')).toBeNull();
  });

  it('refuses a second payment with the same idempotency key for the same user only', async () => {
    const first = pending();
    await repository.insert(first);
    expect(await repository.insert(pending({ idempotencyKey: first.idempotencyKey }))).toBe(false);
    expect(
      await repository.insert(pending({ userId: 'bob', idempotencyKey: first.idempotencyKey })),
    ).toBe(true);
  });

  it('attaches the provider reference only once', async () => {
    const payment = pending();
    await repository.insert(payment);
    expect(await repository.attachProviderReference(payment.id, 'ref-1', NOW)).toBe(true);
    expect(await repository.attachProviderReference(payment.id, 'ref-2', NOW)).toBe(false);
    const stored = await repository.findByIdForUser(payment.id, 'alice');
    expect(stored?.providerReference).toBe('ref-1');
  });

  it('counts attempts per user and per phone within their windows', async () => {
    await repository.insert(pending({ createdAt: minutesAgo(90) })); // hors heure
    await repository.insert(
      pending({ createdAt: minutesAgo(30), status: 'failed', completedAt: NOW }),
    );
    const recent = pending({ createdAt: minutesAgo(5) });
    await repository.insert(recent);
    await repository.insert(pending({ userId: 'bob', createdAt: minutesAgo(10) })); // même numéro
    await repository.insert(pending({ userId: 'bob', phoneHmac: PHONE_B })); // autre numéro
    await repository.insert(pending({ createdAt: minutesAgo(25 * 60) })); // hors journée

    expect(await repository.countAttempts('alice', PHONE_A, attemptWindows(NOW))).toStrictEqual({
      inFlightPaymentId: recent.id,
      userAttemptsLastHour: 2,
      phoneAttemptsLastDay: 4,
    });
    expect(await repository.countAttempts('bob', PHONE_B, attemptWindows(NOW))).toStrictEqual({
      inFlightPaymentId: expect.any(String) as string,
      userAttemptsLastHour: 2,
      phoneAttemptsLastDay: 1,
    });
  });

  it('reports no in-flight payment once it is older than 15 min or no longer pending', async () => {
    await repository.insert(pending({ createdAt: minutesAgo(20) }));
    await repository.insert(
      pending({ createdAt: minutesAgo(1), status: 'failed', completedAt: NOW }),
    );
    expect(await repository.countAttempts('alice', PHONE_A, attemptWindows(NOW))).toMatchObject({
      inFlightPaymentId: null,
    });
  });

  it('counts nothing for a user without payments', async () => {
    expect(await repository.countAttempts('bob', PHONE_B, attemptWindows(NOW))).toStrictEqual({
      inFlightPaymentId: null,
      userAttemptsLastHour: 0,
      phoneAttemptsLastDay: 0,
    });
  });

  it('completes a payment only from the expected status', async () => {
    const payment = pending();
    await repository.insert(payment);
    const later = new Date(NOW.getTime() + 60_000);

    expect(
      await repository.complete(
        payment.id,
        'pending',
        { status: 'succeeded', via: 'webhook' },
        later,
      ),
    ).toBe(true);
    // Le balayage arrive après la notification : rien ne change.
    expect(
      await repository.complete(
        payment.id,
        'pending',
        { status: 'succeeded', via: 'sweep' },
        later,
      ),
    ).toBe(false);

    expect(await repository.findByIdForUser(payment.id, 'alice')).toMatchObject({
      status: 'succeeded',
      confirmedVia: 'webhook',
      failureCode: null,
      completedAt: later,
      updatedAt: later,
    });
  });

  it('lets exactly one of two concurrent completions win', async () => {
    const payment = pending();
    await repository.insert(payment);
    const results = await Promise.all([
      repository.complete(payment.id, 'pending', { status: 'succeeded', via: 'webhook' }, NOW),
      repository.complete(payment.id, 'pending', { status: 'succeeded', via: 'sweep' }, NOW),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('records failure codes, expiry without channel, and expired → succeeded', async () => {
    const failed = pending();
    const expired = pending();
    await repository.insert(failed);
    await repository.insert(expired);

    await repository.complete(
      failed.id,
      'pending',
      { status: 'failed', via: 'sweep', failureCode: 'declined' },
      NOW,
    );
    await repository.complete(
      expired.id,
      'pending',
      { status: 'expired', failureCode: 'no_provider_reference' },
      NOW,
    );
    expect(await repository.findByIdForUser(failed.id, 'alice')).toMatchObject({
      status: 'failed',
      confirmedVia: 'sweep',
      failureCode: 'declined',
    });
    expect(await repository.findByIdForUser(expired.id, 'alice')).toMatchObject({
      status: 'expired',
      confirmedVia: null,
      failureCode: 'no_provider_reference',
    });

    expect(
      await repository.complete(
        expired.id,
        'expired',
        { status: 'succeeded', via: 'webhook' },
        NOW,
      ),
    ).toBe(true);
    expect(await repository.findByIdForUser(expired.id, 'alice')).toMatchObject({
      status: 'succeeded',
      confirmedVia: 'webhook',
      failureCode: null,
    });
  });

  it('lists pending payments created before the cutoff, oldest first', async () => {
    const oldest = pending({ createdAt: minutesAgo(30) });
    const older = pending({ createdAt: minutesAgo(10) });
    await repository.insert(older);
    await repository.insert(oldest);
    await repository.insert(pending({ createdAt: minutesAgo(1) })); // trop récent
    await repository.insert(
      pending({ createdAt: minutesAgo(40), status: 'succeeded', completedAt: NOW }),
    );

    const listed = await repository.listPendingCreatedBefore(minutesAgo(2), 10);
    expect(listed.map((p) => p.id)).toStrictEqual([oldest.id, older.id]);
    expect(await repository.listPendingCreatedBefore(minutesAgo(2), 1)).toHaveLength(1);
  });

  it('deletes payments with their user (ADR-0016)', async () => {
    await pg.db.insert(user).values({ id: 'carol', name: 'Carol', email: 'carol@x.cm' });
    const payment = pending({ userId: 'carol' });
    await repository.insert(payment);
    await pg.sql`delete from "user" where id = 'carol'`;
    expect(await repository.findByExternalReference(payment.externalReference)).toBeNull();
  });
});
