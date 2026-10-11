import { newPendingPayment } from './payment.entity';

describe('newPendingPayment', () => {
  it('creates a pending payment, without provider reference, with exactly the entity fields', () => {
    const now = new Date('2026-10-11T10:00:00Z');
    expect(
      newPendingPayment({
        id: '01a11019-f2e7-7014-8369-af25cb7e0f0c',
        userId: 'alice',
        offerCode: 'pass-30d',
        amountXaf: 2000,
        idempotencyKey: 'key-00001',
        requestHash: 'a'.repeat(64),
        provider: 'campay',
        externalReference: '2ceefe04-1a79-4914-9dd0-c61748c2aecd',
        phoneHmac: 'b'.repeat(64),
        phoneSuffix: '12',
        now,
      }),
    ).toStrictEqual({
      id: '01a11019-f2e7-7014-8369-af25cb7e0f0c',
      userId: 'alice',
      offerCode: 'pass-30d',
      amountXaf: 2000,
      idempotencyKey: 'key-00001',
      requestHash: 'a'.repeat(64),
      provider: 'campay',
      externalReference: '2ceefe04-1a79-4914-9dd0-c61748c2aecd',
      providerReference: null,
      phoneHmac: 'b'.repeat(64),
      phoneSuffix: '12',
      status: 'pending',
      confirmedVia: null,
      failureCode: null,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    });
  });
});
