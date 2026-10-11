import { OfferNotFoundError } from '@/modules/billing/domain/errors/offer-not-found.error';

import {
  FakeBilling,
  FixedClock,
  ImmediateUnitOfWork,
  InMemoryPaymentRepository,
  ScriptedGateway,
} from '../../../../../test/support/fakes';
import { errorCodeOf, valueOf } from '../../../../../test/support/result';
import { type Payment, newPendingPayment } from '../../domain/entities/payment.entity';

import { PaymentSettler } from './payment-settler.service';

const CREATED_AT = new Date('2026-10-11T10:00:00Z');
const NOW = new Date('2026-10-11T10:05:00Z');
const EXTERNAL_REFERENCE = '2ceefe04-1a79-4914-9dd0-c61748c2aecd';

function harness(overrides: Partial<Payment> = {}) {
  const payments = new InMemoryPaymentRepository();
  const gateway = new ScriptedGateway();
  const billing = new FakeBilling();
  const uow = new ImmediateUnitOfWork();
  const payment: Payment = {
    ...newPendingPayment({
      id: '01a11019-f2e7-7014-8369-af25cb7e0f0c',
      userId: 'alice',
      offerCode: 'pass-30d',
      amountXaf: 2000,
      idempotencyKey: 'key-00001',
      requestHash: 'h'.repeat(64),
      provider: 'campay',
      externalReference: EXTERNAL_REFERENCE,
      phoneHmac: 'p'.repeat(64),
      phoneSuffix: '12',
      now: CREATED_AT,
    }),
    providerReference: 'campay-ref',
    ...overrides,
  };
  payments.rows.set(payment.id, payment);
  gateway.transaction = { externalReference: EXTERNAL_REFERENCE, amount: 2000, status: 'pending' };
  const settler = new PaymentSettler(gateway, payments, billing, uow, new FixedClock(NOW));
  const stored = () => payments.rows.get(payment.id);
  return { payments, gateway, billing, uow, payment, settler, stored };
}

describe('PaymentSettler', () => {
  it('grants the offer and marks the payment succeeded, in one transaction', async () => {
    const h = harness();
    h.gateway.transaction = { ...h.gateway.transaction, status: 'successful' };

    const outcome = await h.settler.settle(h.payment, 'webhook');

    expect(outcome.value).toBe('succeeded');
    expect(h.gateway.read).toStrictEqual(['campay-ref']);
    expect(h.billing.grants).toStrictEqual([
      { paymentReference: h.payment.id, userId: 'alice', offerCode: 'pass-30d' },
    ]);
    expect(h.uow.calls).toBe(1);
    expect(h.stored()).toMatchObject({
      status: 'succeeded',
      confirmedVia: 'webhook',
      completedAt: NOW,
    });
  });

  it('grants a payment confirmed after the sweep gave up on it', async () => {
    const h = harness({ status: 'expired', completedAt: NOW });
    h.gateway.transaction = { ...h.gateway.transaction, status: 'successful' };

    expect(await valueOf(h.settler.settle(h.payment, 'webhook'))).toBe('succeeded');
    expect(h.billing.grants).toHaveLength(1);
    expect(h.stored()?.status).toBe('succeeded');
  });

  it('grants nothing when another path concluded the payment first', async () => {
    const h = harness();
    h.gateway.transaction = { ...h.gateway.transaction, status: 'successful' };
    // Le balayage a conclu entre la lecture du paiement et l'écriture.
    h.payments.rows.set(h.payment.id, { ...h.payment, status: 'succeeded', completedAt: NOW });

    expect(await valueOf(h.settler.settle(h.payment, 'webhook'))).toBe('raced');
    expect(h.billing.grants).toHaveLength(0);
  });

  it('refuses to leave a succeeded payment without its offer', async () => {
    const h = harness();
    h.gateway.transaction = { ...h.gateway.transaction, status: 'successful' };
    h.billing.grantError = new OfferNotFoundError('pass-30d');

    await expect(h.settler.settle(h.payment, 'webhook')).rejects.toThrow(/Grant refused/);
  });

  it('marks a declined payment failed', async () => {
    const h = harness();
    h.gateway.transaction = { ...h.gateway.transaction, status: 'failed' };

    expect(await valueOf(h.settler.settle(h.payment, 'sweep'))).toBe('failed');
    expect(h.stored()).toMatchObject({
      status: 'failed',
      confirmedVia: 'sweep',
      failureCode: 'declined',
    });
    expect(h.billing.grants).toHaveLength(0);
  });

  it('reports a race on failure too', async () => {
    const h = harness();
    h.gateway.transaction = { ...h.gateway.transaction, status: 'failed' };
    h.payments.rows.set(h.payment.id, { ...h.payment, status: 'failed', completedAt: NOW });
    expect(await valueOf(h.settler.settle(h.payment, 'sweep'))).toBe('raced');
  });

  it('flags an amount that differs from the copied price, and grants nothing', async () => {
    const h = harness();
    h.gateway.transaction = { ...h.gateway.transaction, status: 'successful', amount: 25 };

    expect(await valueOf(h.settler.settle(h.payment, 'webhook'))).toBe('amount_mismatch');
    expect(h.stored()).toMatchObject({ status: 'amount_mismatch', confirmedVia: 'webhook' });
    expect(h.billing.grants).toHaveLength(0);
  });

  it('reports a race on an amount mismatch too', async () => {
    const h = harness();
    h.gateway.transaction = { ...h.gateway.transaction, status: 'successful', amount: 25 };
    h.payments.rows.set(h.payment.id, { ...h.payment, status: 'failed', completedAt: NOW });
    expect(await valueOf(h.settler.settle(h.payment, 'webhook'))).toBe('raced');
  });

  it('waits while the provider still waits', async () => {
    const h = harness();
    expect(await valueOf(h.settler.settle(h.payment, 'sweep'))).toBe('waiting');
    expect(h.stored()?.status).toBe('pending');
  });

  it('changes nothing for a replayed notification', async () => {
    const h = harness({ status: 'succeeded', completedAt: NOW });
    h.gateway.transaction = { ...h.gateway.transaction, status: 'successful' };
    expect(await valueOf(h.settler.settle(h.payment, 'webhook'))).toBe('unchanged');
    expect(h.billing.grants).toHaveLength(0);
  });

  it('touches nothing on an anomaly', async () => {
    const h = harness({ status: 'succeeded', completedAt: NOW });
    h.gateway.transaction = { ...h.gateway.transaction, status: 'failed' };
    expect(await valueOf(h.settler.settle(h.payment, 'webhook'))).toBe('anomaly');
    expect(h.stored()?.status).toBe('succeeded');
  });

  it('has nothing to read without a provider reference', async () => {
    const h = harness({ providerReference: null });
    expect(await valueOf(h.settler.settle(h.payment, 'sweep'))).toBe('waiting');
    expect(h.gateway.read).toHaveLength(0);
  });

  it('reports an unreachable provider', async () => {
    const h = harness();
    h.gateway.transaction = null;
    expect(await errorCodeOf(h.settler.settle(h.payment, 'sweep'))).toBe(
      'INFRASTRUCTURE_PAYMENT_UNAVAILABLE',
    );
  });

  describe('with the reference named by a notification', () => {
    it('attaches it to a payment whose provider answer was lost, once it is confirmed ours', async () => {
      const h = harness({ providerReference: null });
      h.gateway.transaction = { ...h.gateway.transaction, status: 'successful' };

      const outcome = await h.settler.settleWithReference(h.payment, 'late-ref', 'webhook');

      expect(outcome.value).toBe('succeeded');
      expect(h.stored()?.providerReference).toBe('late-ref');
    });

    it('never attaches a reference whose transaction is not ours', async () => {
      const h = harness({ providerReference: null });
      h.gateway.transaction = {
        status: 'successful',
        amount: 2000,
        externalReference: '9f1c4a52-7a0e-4b8e-a0a8-3c2f5d1e6b7a',
      };

      const outcome = await h.settler.settleWithReference(h.payment, 'other-ref', 'webhook');

      expect(outcome.value).toBe('anomaly');
      expect(h.stored()).toMatchObject({ providerReference: null, status: 'pending' });
      expect(h.billing.grants).toHaveLength(0);
    });
  });
});
