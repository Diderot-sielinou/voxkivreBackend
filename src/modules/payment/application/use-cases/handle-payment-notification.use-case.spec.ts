import {
  FakeBilling,
  FixedClock,
  ImmediateUnitOfWork,
  InMemoryPaymentRepository,
  ScriptedGateway,
} from '../../../../../test/support/fakes';
import { errorCodeOf, valueOf } from '../../../../../test/support/result';
import { type Payment, newPendingPayment } from '../../domain/entities/payment.entity';
import { type PaymentProvider } from '../../domain/value-objects/payment-status.vo';
import { PaymentSettler } from '../services/payment-settler.service';

import { HandlePaymentNotificationUseCase } from './handle-payment-notification.use-case';

const NOW = new Date('2026-10-11T10:05:00Z');
const EXTERNAL_REFERENCE = '2ceefe04-1a79-4914-9dd0-c61748c2aecd';

function harness(provider: PaymentProvider | null = 'campay', overrides: Partial<Payment> = {}) {
  const payments = new InMemoryPaymentRepository();
  const gateway = new ScriptedGateway(provider);
  const billing = new FakeBilling();
  const payment: Payment = {
    ...newPendingPayment({
      id: '01a11019-f2e7-7014-8369-af25cb7e0f0c',
      userId: 'alice',
      offerCode: 'credits-s',
      amountXaf: 500,
      idempotencyKey: 'key-00001',
      requestHash: 'h'.repeat(64),
      provider: 'campay',
      externalReference: EXTERNAL_REFERENCE,
      phoneHmac: 'p'.repeat(64),
      phoneSuffix: '12',
      now: new Date('2026-10-11T10:00:00Z'),
    }),
    providerReference: 'campay-ref',
    ...overrides,
  };
  payments.rows.set(payment.id, payment);
  gateway.transaction = {
    externalReference: EXTERNAL_REFERENCE,
    amount: 500,
    status: 'successful',
  };
  const settler = new PaymentSettler(
    gateway,
    payments,
    billing,
    new ImmediateUnitOfWork(),
    new FixedClock(NOW),
  );
  const useCase = new HandlePaymentNotificationUseCase(gateway, payments, settler);
  return { payments, gateway, billing, payment, useCase };
}

describe('HandlePaymentNotificationUseCase', () => {
  it('re-reads the state at the provider and grants the offer', async () => {
    const h = harness();
    h.gateway.notification = { reference: 'campay-ref', externalReference: EXTERNAL_REFERENCE };

    expect(await valueOf(h.useCase.execute({ any: 'payload' }))).toBe('succeeded');
    expect(h.gateway.read).toStrictEqual(['campay-ref']);
    expect(h.payments.rows.get(h.payment.id)).toMatchObject({
      status: 'succeeded',
      confirmedVia: 'webhook',
    });
    expect(h.billing.grants).toHaveLength(1);
  });

  it('changes nothing when the same notification is replayed (RNF-09)', async () => {
    const h = harness();
    await h.useCase.execute({});
    expect(await valueOf(h.useCase.execute({}))).toBe('unchanged');
    expect(h.billing.grants).toHaveLength(1);
  });

  it('finds a payment whose provider answer was lost, by our external reference', async () => {
    const h = harness('campay', { providerReference: null });
    h.gateway.notification = { reference: 'late-ref', externalReference: EXTERNAL_REFERENCE };

    expect(await valueOf(h.useCase.execute({}))).toBe('succeeded');
    expect(h.payments.rows.get(h.payment.id)?.providerReference).toBe('late-ref');
  });

  it.each([
    [
      'an unknown reference without external reference',
      { reference: 'x', externalReference: null },
    ],
    [
      'an unknown reference and external reference',
      { reference: 'x', externalReference: '9f1c4a52-7a0e-4b8e-a0a8-3c2f5d1e6b7a' },
    ],
  ])('ignores %s, so that the provider stops retrying', async (_label, target) => {
    const h = harness();
    h.gateway.notification = target;
    expect(await valueOf(h.useCase.execute({}))).toBe('ignored');
    expect(h.gateway.read).toHaveLength(0);
  });

  it('refuses an invalid signature without reading anything', async () => {
    const h = harness();
    h.gateway.notification = null;
    expect(await errorCodeOf(h.useCase.execute({}))).toBe('UNAUTHORIZED_PAYMENT_NOTIFICATION');
    expect(h.gateway.read).toHaveLength(0);
  });

  it('refuses every notification while payments are disabled', async () => {
    const h = harness(null);
    expect(await errorCodeOf(h.useCase.execute({}))).toBe('UNAUTHORIZED_PAYMENT_NOTIFICATION');
  });

  it('reports an unreachable provider, so that it retries later', async () => {
    const h = harness();
    h.gateway.transaction = null;
    expect(await errorCodeOf(h.useCase.execute({}))).toBe('INFRASTRUCTURE_PAYMENT_UNAVAILABLE');
    expect(h.payments.rows.get(h.payment.id)?.status).toBe('pending');
  });
});
