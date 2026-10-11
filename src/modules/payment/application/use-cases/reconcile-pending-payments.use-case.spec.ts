import {
  FakeBilling,
  FixedClock,
  ImmediateUnitOfWork,
  InMemoryPaymentRepository,
  ScriptedGateway,
} from '../../../../../test/support/fakes';
import { type Payment, newPendingPayment } from '../../domain/entities/payment.entity';
import { type ProviderTransaction } from '../../domain/provider-transaction';
import { PaymentSettler } from '../services/payment-settler.service';

import {
  RECONCILE_BATCH_SIZE,
  ReconcilePendingPaymentsUseCase,
} from './reconcile-pending-payments.use-case';

const NOW = new Date('2026-10-11T08:05:00Z');
const MINUTE = 60_000;

let sequence = 0;

function payment(minutesAgo: number, overrides: Partial<Payment> = {}): Payment {
  sequence += 1;
  const n = String(sequence).padStart(12, '0');
  return {
    ...newPendingPayment({
      id: `01a11019-f2e7-7014-8369-${n}`,
      userId: 'alice',
      offerCode: 'credits-s',
      amountXaf: 500,
      idempotencyKey: `key-${n}`,
      requestHash: 'h'.repeat(64),
      provider: 'campay',
      externalReference: `2ceefe04-1a79-4914-9dd0-${n}`,
      phoneHmac: 'p'.repeat(64),
      phoneSuffix: '12',
      now: new Date(NOW.getTime() - minutesAgo * MINUTE),
    }),
    providerReference: `ref-${n}`,
    ...overrides,
  };
}

/** Prestataire dont l'état dépend de la transaction relue. */
class StatusByReferenceGateway extends ScriptedGateway {
  constructor(
    private readonly payments: InMemoryPaymentRepository,
    private readonly statuses: Readonly<Record<string, ProviderTransaction['status'] | 'down'>>,
  ) {
    super('campay');
  }

  override getTransaction(reference: string) {
    const target = [...this.payments.rows.values()].find((p) => p.providerReference === reference);
    const status = this.statuses[reference] ?? 'pending';
    this.transaction =
      status === 'down'
        ? null
        : { externalReference: target?.externalReference ?? null, amount: 500, status };
    return super.getTransaction(reference);
  }
}

function harness(
  rows: readonly Payment[],
  statuses: Readonly<Record<string, ProviderTransaction['status'] | 'down'>> = {},
) {
  const payments = new InMemoryPaymentRepository();
  for (const row of rows) payments.rows.set(row.id, row);
  const gateway = new StatusByReferenceGateway(payments, statuses);
  const billing = new FakeBilling();
  const clock = new FixedClock(NOW);
  const settler = new PaymentSettler(gateway, payments, billing, new ImmediateUnitOfWork(), clock);
  const useCase = new ReconcilePendingPaymentsUseCase(payments, settler, clock);
  const statusOf = (p: Payment) => payments.rows.get(p.id);
  return { payments, gateway, billing, useCase, statusOf };
}

describe('ReconcilePendingPaymentsUseCase', () => {
  it('concludes payments whose notification never came (night stop), and leaves the recent ones', async () => {
    const paidAtNight = payment(9 * 60);
    const declined = payment(30);
    const stillWaiting = payment(10);
    const tooRecent = payment(1);
    const h = harness([paidAtNight, declined, stillWaiting, tooRecent], {
      [paidAtNight.providerReference ?? '']: 'successful',
      [declined.providerReference ?? '']: 'failed',
    });

    const report = await h.useCase.execute();

    expect(report).toMatchObject({ examined: 3, succeeded: 1, failed: 1, waiting: 1 });
    expect(h.statusOf(paidAtNight)).toMatchObject({ status: 'succeeded', confirmedVia: 'sweep' });
    expect(h.statusOf(declined)).toMatchObject({ status: 'failed', confirmedVia: 'sweep' });
    expect(h.statusOf(stillWaiting)?.status).toBe('pending');
    expect(h.gateway.read).not.toContain(tooRecent.providerReference);
    expect(h.billing.grants).toStrictEqual([
      { paymentReference: paidAtNight.id, userId: 'alice', offerCode: 'credits-s' },
    ]);
  });

  it('gives up on a payment still waiting after 24 h', async () => {
    const stale = payment(24 * 60);
    const h = harness([stale]);
    expect(await h.useCase.execute()).toMatchObject({ expired: 1 });
    expect(h.statusOf(stale)).toMatchObject({
      status: 'expired',
      confirmedVia: null,
      failureCode: null,
    });
  });

  it('gives up after 15 min on a request the provider never acknowledged', async () => {
    const lost = payment(15, { providerReference: null });
    const recentLost = payment(5, { providerReference: null });
    const h = harness([lost, recentLost]);

    expect(await h.useCase.execute()).toMatchObject({ expired: 1, waiting: 1 });
    expect(h.statusOf(lost)).toMatchObject({
      status: 'expired',
      failureCode: 'no_provider_reference',
    });
    expect(h.statusOf(recentLost)?.status).toBe('pending');
    expect(h.gateway.read).toHaveLength(0);
  });

  it('never expires a payment the provider confirms on the last read', async () => {
    const lastMinute = payment(24 * 60);
    const h = harness([lastMinute], { [lastMinute.providerReference ?? '']: 'successful' });
    expect(await h.useCase.execute()).toMatchObject({ succeeded: 1, expired: 0 });
  });

  it('counts an unreachable provider and goes on with the next payment', async () => {
    const unreachable = payment(30);
    const paid = payment(20);
    const h = harness([unreachable, paid], {
      [unreachable.providerReference ?? '']: 'down',
      [paid.providerReference ?? '']: 'successful',
    });
    expect(await h.useCase.execute()).toMatchObject({ unavailable: 1, succeeded: 1 });
    expect(h.statusOf(unreachable)?.status).toBe('pending');
  });

  it('reports a payment concluded by a notification during the sweep', async () => {
    const stale = payment(24 * 60);
    const h = harness([stale]);
    // La notification conclut le paiement juste avant l'écriture du balayage.
    const complete = h.payments.complete.bind(h.payments);
    jest.spyOn(h.payments, 'complete').mockImplementationOnce(async (id, from, completion, at) => {
      h.payments.rows.set(id, { ...stale, status: 'succeeded', completedAt: at });
      return complete(id, from, completion, at);
    });
    expect(await h.useCase.execute()).toMatchObject({ raced: 1, expired: 0 });
  });

  it('reads at most one batch per run, oldest first', async () => {
    const rows = Array.from({ length: RECONCILE_BATCH_SIZE + 5 }, (_, i) => payment(300 - i));
    const h = harness(rows);
    const report = await h.useCase.execute();
    expect(report.examined).toBe(RECONCILE_BATCH_SIZE);
    expect(h.gateway.read[0]).toBe(rows[0].providerReference);
  });

  it('reports an empty run', async () => {
    expect(await harness([]).useCase.execute()).toStrictEqual({
      examined: 0,
      succeeded: 0,
      failed: 0,
      amount_mismatch: 0,
      waiting: 0,
      unchanged: 0,
      raced: 0,
      anomaly: 0,
      expired: 0,
      unavailable: 0,
    });
  });
});
