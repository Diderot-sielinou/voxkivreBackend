import { type Payment, newPendingPayment } from '../entities/payment.entity';
import { type ProviderTransaction } from '../provider-transaction';
import { type PaymentStatus } from '../value-objects/payment-status.vo';

import { isAmountMatching, settlementFor } from './settlement';

const EXTERNAL_REFERENCE = '2ceefe04-1a79-4914-9dd0-c61748c2aecd';

function payment(status: PaymentStatus = 'pending'): Payment {
  return {
    ...newPendingPayment({
      id: '01a11019-f2e7-7014-8369-af25cb7e0f0c',
      userId: 'alice',
      offerCode: 'pass-30d',
      amountXaf: 2000,
      idempotencyKey: 'key-00001',
      requestHash: 'a'.repeat(64),
      provider: 'campay',
      externalReference: EXTERNAL_REFERENCE,
      phoneHmac: 'b'.repeat(64),
      phoneSuffix: '12',
      now: new Date('2026-10-11T10:00:00Z'),
    }),
    status,
  };
}

function transaction(overrides: Partial<ProviderTransaction> = {}): ProviderTransaction {
  return {
    reference: 'bcedde9b-62a7-4421-96ac-2e6179552a1a',
    externalReference: EXTERNAL_REFERENCE,
    status: 'successful',
    amount: 2000,
    currency: 'XAF',
    ...overrides,
  };
}

describe('settlementFor', () => {
  it.each<[PaymentStatus, ProviderTransaction['status'], ReturnType<typeof settlementFor>]>([
    ['pending', 'pending', { kind: 'wait' }],
    ['pending', 'successful', { kind: 'succeed', from: 'pending' }],
    ['pending', 'failed', { kind: 'fail', failureCode: 'declined' }],
    // Confirmé après abandon par le balayage : le client a payé (§5).
    ['expired', 'successful', { kind: 'succeed', from: 'expired' }],
    ['expired', 'failed', { kind: 'none' }],
    ['expired', 'pending', { kind: 'none' }],
    // Notifications rejouées : rien de plus.
    ['succeeded', 'successful', { kind: 'none' }],
    ['failed', 'failed', { kind: 'none' }],
    ['amount_mismatch', 'successful', { kind: 'none' }],
    ['amount_mismatch', 'failed', { kind: 'none' }],
    ['succeeded', 'pending', { kind: 'none' }],
    // Incohérences du prestataire : examen à la main, rien n'est modifié.
    ['failed', 'successful', { kind: 'anomaly', reason: 'successful_after_failure' }],
    ['succeeded', 'failed', { kind: 'anomaly', reason: 'failed_after_success' }],
  ])('%s payment + %s transaction → %o', (status, providerStatus, expected) => {
    expect(settlementFor(payment(status), transaction({ status: providerStatus }))).toStrictEqual(
      expected,
    );
  });

  it('flags a successful transaction whose amount differs from the copied price', () => {
    expect(settlementFor(payment(), transaction({ amount: 25 }))).toStrictEqual({
      kind: 'flag_amount_mismatch',
    });
  });

  it.each([
    ['another reference', '9f1c4a52-7a0e-4b8e-a0a8-3c2f5d1e6b7a'],
    ['no reference', null],
  ])('refuses a transaction carrying %s', (_label, externalReference) => {
    expect(settlementFor(payment(), transaction({ externalReference }))).toStrictEqual({
      kind: 'anomaly',
      reason: 'reference_mismatch',
    });
  });

  it('compares our reference regardless of case', () => {
    expect(
      settlementFor(
        payment(),
        transaction({ externalReference: EXTERNAL_REFERENCE.toUpperCase() }),
      ),
    ).toStrictEqual({ kind: 'succeed', from: 'pending' });
  });
});

describe('isAmountMatching', () => {
  it('accepts the provider decimal when it is whole', () => {
    // Ce que le parseur JSON fait de `2000.0` renvoyé par Campay.
    const amount = JSON.parse('{"amount": 2000.0}') as { amount: number };
    expect(isAmountMatching(2000, transaction(amount))).toBe(true);
  });

  it('accepts the currency in any case', () => {
    expect(isAmountMatching(2000, transaction({ currency: 'xaf' }))).toBe(true);
  });

  it.each([
    ['a fractional amount, never rounded', { amount: 2000.5 }],
    ['a lower amount', { amount: 1999 }],
    ['a higher amount', { amount: 2001 }],
    ['another currency', { currency: 'EUR' }],
    ['a non-finite amount', { amount: Number.NaN }],
  ])('rejects %s', (_label, overrides) => {
    expect(isAmountMatching(2000, transaction(overrides))).toBe(false);
  });
});
