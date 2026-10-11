import { type Payment, newPendingPayment } from '../entities/payment.entity';

import { attemptRefusalFor, attemptWindows, isExpiryDue, sweepCutoff } from './payment-policy';

const CREATED_AT = new Date('2026-10-11T10:00:00Z');
const MINUTE = 60 * 1000;

function payment(overrides: Partial<Payment> = {}): Payment {
  return {
    ...newPendingPayment({
      id: '01a11019-f2e7-7014-8369-af25cb7e0f0c',
      userId: 'alice',
      offerCode: 'credits-s',
      amountXaf: 500,
      idempotencyKey: 'key-00001',
      requestHash: 'a'.repeat(64),
      provider: 'campay',
      externalReference: '2ceefe04-1a79-4914-9dd0-c61748c2aecd',
      phoneHmac: 'b'.repeat(64),
      phoneSuffix: '12',
      now: CREATED_AT,
    }),
    providerReference: 'bcedde9b-62a7-4421-96ac-2e6179552a1a',
    ...overrides,
  };
}

function minutesAfterCreation(minutes: number): Date {
  return new Date(CREATED_AT.getTime() + minutes * MINUTE);
}

describe('attemptWindows', () => {
  it('counts in-flight payments over 15 min, user attempts over 1 h, phone attempts over 24 h', () => {
    const now = new Date('2026-10-11T12:00:00Z');
    expect(attemptWindows(now)).toStrictEqual({
      inFlightSince: new Date('2026-10-11T11:45:00Z'),
      userSince: new Date('2026-10-11T11:00:00Z'),
      phoneSince: new Date('2026-10-10T12:00:00Z'),
    });
  });
});

describe('attemptRefusalFor', () => {
  it('allows up to 4 previous attempts per user and 2 per phone', () => {
    expect(attemptRefusalFor({ userAttemptsLastHour: 4, phoneAttemptsLastDay: 2 })).toBeNull();
  });

  it('refuses the 6th attempt of the hour for a user', () => {
    expect(attemptRefusalFor({ userAttemptsLastHour: 5, phoneAttemptsLastDay: 0 })).toBe(
      'user_hourly_limit',
    );
  });

  it('refuses the 4th attempt of the day on a phone number', () => {
    expect(attemptRefusalFor({ userAttemptsLastHour: 0, phoneAttemptsLastDay: 3 })).toBe(
      'phone_daily_limit',
    );
  });
});

describe('sweepCutoff', () => {
  it('leaves the notification 2 minutes before polling', () => {
    expect(sweepCutoff(minutesAfterCreation(2))).toStrictEqual(CREATED_AT);
  });
});

describe('isExpiryDue', () => {
  it('keeps polling a referenced payment for 24 h', () => {
    expect(isExpiryDue(payment(), minutesAfterCreation(24 * 60 - 1))).toBe(false);
    expect(isExpiryDue(payment(), minutesAfterCreation(24 * 60))).toBe(true);
  });

  it('gives up after 15 min on a request the provider never acknowledged', () => {
    const unreferenced = payment({ providerReference: null });
    expect(isExpiryDue(unreferenced, minutesAfterCreation(14))).toBe(false);
    expect(isExpiryDue(unreferenced, minutesAfterCreation(15))).toBe(true);
  });

  it('never expires a payment that already left pending', () => {
    expect(isExpiryDue(payment({ status: 'succeeded' }), minutesAfterCreation(48 * 60))).toBe(
      false,
    );
  });
});
