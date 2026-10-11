import { InMemoryPaymentRepository } from '../../../../../test/support/fakes';
import { errorCodeOf, valueOf } from '../../../../../test/support/result';
import { newPendingPayment } from '../../domain/entities/payment.entity';

import { GetPaymentUseCase } from './get-payment.use-case';

describe('GetPaymentUseCase', () => {
  const payments = new InMemoryPaymentRepository();
  const payment = newPendingPayment({
    id: '01a11019-f2e7-7014-8369-af25cb7e0f0c',
    userId: 'alice',
    offerCode: 'pass-30d',
    amountXaf: 2000,
    idempotencyKey: 'key-00001',
    requestHash: 'h'.repeat(64),
    provider: 'campay',
    externalReference: '2ceefe04-1a79-4914-9dd0-c61748c2aecd',
    phoneHmac: 'p'.repeat(64),
    phoneSuffix: '12',
    now: new Date('2026-10-11T10:00:00Z'),
  });
  payments.rows.set(payment.id, payment);
  const useCase = new GetPaymentUseCase(payments);

  it("returns the user's own payment", async () => {
    expect(await valueOf(useCase.execute(payment.id, 'alice'))).toStrictEqual(payment);
  });

  it.each([
    ['an unknown payment', 'unknown', 'alice'],
    ["another user's payment, with the same answer (RNF-08)", payment.id, 'bob'],
  ])('reports %s as not found', async (_label, id, userId) => {
    expect(await errorCodeOf(useCase.execute(id, userId))).toBe('PAYMENT_NOT_FOUND');
  });
});
