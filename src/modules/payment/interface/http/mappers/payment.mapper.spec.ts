import { newPendingPayment } from '@/modules/payment/domain/entities/payment.entity';

import { toPaymentResponseDto } from './payment.mapper';

describe('toPaymentResponseDto', () => {
  const payment = {
    ...newPendingPayment({
      id: '01a11019-f2e7-7014-8369-af25cb7e0f0c',
      userId: 'alice',
      offerCode: 'pass-30d',
      amountXaf: 2000,
      idempotencyKey: 'key-00001',
      requestHash: 'h'.repeat(64),
      provider: 'campay',
      externalReference: '2ceefe04-1a79-4914-9dd0-c61748c2aecd',
      phoneHmac: 'p'.repeat(64),
      phoneSuffix: '47',
      now: new Date('2026-10-11T10:00:00Z'),
    }),
    providerReference: 'campay-ref',
  } as const;

  it('exposes exactly the public fields: no references, hashes nor idempotency key', () => {
    expect(toPaymentResponseDto(payment)).toStrictEqual({
      id: '01a11019-f2e7-7014-8369-af25cb7e0f0c',
      status: 'pending',
      offerCode: 'pass-30d',
      amountXaf: 2000,
      phoneSuffix: '47',
      failureCode: null,
      createdAt: '2026-10-11T10:00:00.000Z',
      completedAt: null,
    });
  });

  it('dates a concluded payment', () => {
    const failed = {
      ...payment,
      status: 'failed',
      failureCode: 'declined',
      completedAt: new Date('2026-10-11T10:03:00Z'),
    } as const;
    expect(toPaymentResponseDto(failed)).toMatchObject({
      status: 'failed',
      failureCode: 'declined',
      completedAt: '2026-10-11T10:03:00.000Z',
    });
  });
});
