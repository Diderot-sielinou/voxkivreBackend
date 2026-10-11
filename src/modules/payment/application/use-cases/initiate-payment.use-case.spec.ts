import { Result } from '@/shared/kernel';

import {
  FakeBilling,
  FakePhoneHasher,
  FixedClock,
  InMemoryPaymentRepository,
  ScriptedGateway,
} from '../../../../../test/support/fakes';
import { errorCodeOf, valueOf } from '../../../../../test/support/result';
import { newPendingPayment } from '../../domain/entities/payment.entity';
import { InvalidPaymentPhoneError } from '../../domain/errors/invalid-payment-phone.error';
import { PaymentUnavailableError } from '../../domain/errors/payment-unavailable.error';
import { type PaymentProvider } from '../../domain/value-objects/payment-status.vo';

import { type InitiatePaymentInput, InitiatePaymentUseCase } from './initiate-payment.use-case';

const NOW = new Date('2026-10-11T10:00:00Z');
const MINUTE = 60_000;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const INPUT: InitiatePaymentInput = {
  userId: 'alice',
  offerCode: 'pass-30d',
  phoneNumber: '6 99 00 00 12',
  idempotencyKey: 'key-00001',
};

function harness(provider: PaymentProvider | null = 'campay') {
  const payments = new InMemoryPaymentRepository();
  const gateway = new ScriptedGateway(provider);
  const billing = new FakeBilling();
  const clock = new FixedClock(NOW);
  const useCase = new InitiatePaymentUseCase(
    gateway,
    payments,
    billing,
    new FakePhoneHasher(),
    clock,
  );
  return { payments, gateway, billing, clock, useCase };
}

/** Paiement antérieur, pour les plafonds. */
function previous(
  overrides: { userId?: string; phone?: string; minutesAgo: number; status?: 'pending' | 'failed' },
  n: number,
) {
  const createdAt = new Date(NOW.getTime() - overrides.minutesAgo * MINUTE);
  const payment = newPendingPayment({
    id: `previous-${String(n)}`,
    userId: overrides.userId ?? 'alice',
    offerCode: 'credits-s',
    amountXaf: 500,
    idempotencyKey: `previous-key-${String(n)}`,
    requestHash: 'h'.repeat(64),
    provider: 'campay',
    externalReference: `previous-ext-${String(n)}`,
    phoneHmac: `hmac(${overrides.phone ?? '+237699000012'})`.padEnd(64, '.'),
    phoneSuffix: '12',
    now: createdAt,
  });
  return overrides.status === 'failed'
    ? { ...payment, status: 'failed' as const, completedAt: createdAt }
    : payment;
}

describe('InitiatePaymentUseCase', () => {
  it('records a pending payment at the catalogue price, then asks the provider', async () => {
    const h = harness();

    const result = await h.useCase.execute(INPUT);

    const payment = result.value;
    expect(payment).toMatchObject({
      userId: 'alice',
      offerCode: 'pass-30d',
      amountXaf: 2000,
      idempotencyKey: 'key-00001',
      provider: 'campay',
      providerReference: 'campay-ref',
      phoneSuffix: '12',
      phoneHmac: 'hmac(+237699000012)'.padEnd(64, '.'),
      status: 'pending',
      createdAt: NOW,
    });
    expect(payment.externalReference).toMatch(UUID_V4);
    expect(h.gateway.collected).toStrictEqual([
      {
        externalReference: payment.externalReference,
        amountXaf: 2000,
        phone: '+237699000012',
        description: 'Voxlivre - Pass 30 jours',
      },
    ]);
    expect(h.payments.rows.get(payment.id)?.providerReference).toBe('campay-ref');
  });

  it('never stores the phone number in clear, not even inside the request hash', async () => {
    const h = harness();
    const payment = await valueOf(h.useCase.execute(INPUT));
    // Le faux hacheur est lisible par construction : seul ce champ en dépend.
    const stored = { ...h.payments.rows.get(payment.id), phoneHmac: 'opaque' };
    expect(JSON.stringify(stored)).not.toContain('699000012');
    const other = harness();
    const samePhoneOtherKey = await valueOf(
      other.useCase.execute({ ...INPUT, idempotencyKey: 'key-00002' }),
    );
    expect(samePhoneOtherKey.requestHash).toBe(payment.requestHash);
  });

  it('refuses when payments are disabled, before anything is stored', async () => {
    const h = harness(null);
    expect(await errorCodeOf(h.useCase.execute(INPUT))).toBe('INFRASTRUCTURE_PAYMENT_UNAVAILABLE');
    expect(h.payments.rows.size).toBe(0);
  });

  it.each([
    ['an invalid idempotency key', { idempotencyKey: 'short' }, 'INVALID_IDEMPOTENCY_KEY'],
    ['a foreign phone', { phoneNumber: '+33612345678' }, 'INVALID_PAYMENT_PHONE'],
    ['an unknown offer', { offerCode: 'credits-xl' }, 'OFFER_NOT_FOUND'],
  ])('refuses %s, before anything is stored', async (_label, override, code) => {
    const h = harness();
    expect(await errorCodeOf(h.useCase.execute({ ...INPUT, ...override }))).toBe(code);
    expect(h.payments.rows.size).toBe(0);
    expect(h.gateway.collected).toHaveLength(0);
  });

  describe('idempotency', () => {
    it('returns the same payment for the same key and request, without a second prompt', async () => {
      const h = harness();
      const first = await valueOf(h.useCase.execute(INPUT));
      const again = await h.useCase.execute({ ...INPUT, phoneNumber: '+237699000012' });
      expect(again.value).toStrictEqual(first);
      expect(h.gateway.collected).toHaveLength(1);
    });

    it('refuses the same key for a different request', async () => {
      const h = harness();
      await h.useCase.execute(INPUT);
      expect(await errorCodeOf(h.useCase.execute({ ...INPUT, offerCode: 'credits-s' }))).toBe(
        'PAYMENT_IDEMPOTENCY_CONFLICT',
      );
    });

    it('lets two users use the same key', async () => {
      const h = harness();
      await h.useCase.execute(INPUT);
      const bob = await h.useCase.execute({ ...INPUT, userId: 'bob', phoneNumber: '699000013' });
      expect(bob.isOk()).toBe(true);
      expect(h.payments.rows.size).toBe(2);
    });

    it('returns the winner when the same key arrives twice at once', async () => {
      const h = harness();
      const [a, b] = await Promise.all([h.useCase.execute(INPUT), h.useCase.execute(INPUT)]);
      expect(h.payments.rows.size).toBe(1);
      expect(a.value.id).toBe(b.value.id);
    });

    it('refuses a concurrent duplicate key carrying a different request', async () => {
      const h = harness();
      const [, b] = await Promise.all([
        h.useCase.execute(INPUT),
        h.useCase.execute({ ...INPUT, offerCode: 'credits-s' }),
      ]);
      expect(b.error.code).toBe('PAYMENT_IDEMPOTENCY_CONFLICT');
    });
  });

  describe('lost or refused provider answer', () => {
    it('keeps the payment pending without reference when the provider is unreachable', async () => {
      const h = harness();
      h.gateway.collectResult = Result.err(
        new PaymentUnavailableError('Campay collect unreachable'),
      );

      expect(await errorCodeOf(h.useCase.execute(INPUT))).toBe(
        'INFRASTRUCTURE_PAYMENT_UNAVAILABLE',
      );
      const [stored] = h.payments.rows.values();
      expect(stored).toMatchObject({ status: 'pending', providerReference: null });
    });

    it('asks again with the same external reference when the same key is replayed', async () => {
      const h = harness();
      h.gateway.collectResult = Result.err(
        new PaymentUnavailableError('Campay collect unreachable'),
      );
      await h.useCase.execute(INPUT);
      h.gateway.collectResult = Result.ok({ reference: 'campay-ref' });

      const replayed = await h.useCase.execute(INPUT);

      expect(replayed.value.providerReference).toBe('campay-ref');
      expect(h.gateway.collected).toHaveLength(2);
      expect(h.gateway.collected[1].externalReference).toBe(
        h.gateway.collected[0].externalReference,
      );
    });

    it('does not ask again if the offer was withdrawn in between', async () => {
      const h = harness();
      h.gateway.collectResult = Result.err(
        new PaymentUnavailableError('Campay collect unreachable'),
      );
      await h.useCase.execute(INPUT);
      const withdrawn = new InitiatePaymentUseCase(
        h.gateway,
        h.payments,
        new FakeBilling([]),
        new FakePhoneHasher(),
        h.clock,
      );

      const replayed = await withdrawn.execute(INPUT);

      expect(replayed.value.providerReference).toBeNull();
      expect(h.gateway.collected).toHaveLength(1);
    });

    it('fails the payment when the provider refuses the number (ER101, ER102)', async () => {
      const h = harness();
      h.gateway.collectResult = Result.err(new InvalidPaymentPhoneError('refused'));

      expect(await errorCodeOf(h.useCase.execute(INPUT))).toBe('INVALID_PAYMENT_PHONE');
      const [stored] = h.payments.rows.values();
      expect(stored).toMatchObject({
        status: 'failed',
        confirmedVia: null,
        failureCode: 'invalid_phone',
        completedAt: NOW,
      });
      // Rejouée, la requête montre le paiement échoué sans redemander.
      const replayed = await valueOf(h.useCase.execute(INPUT));
      expect(replayed.status).toBe('failed');
      expect(h.gateway.collected).toHaveLength(1);
    });
  });

  describe('anti-abuse limits', () => {
    it('refuses while a recent payment of the user still waits for confirmation', async () => {
      const h = harness();
      const waiting = previous({ minutesAgo: 14 }, 1);
      await h.payments.insert(waiting);
      const result = await h.useCase.execute(INPUT);
      expect(result.error.code).toBe('PAYMENT_IN_PROGRESS_CONFLICT');
      expect(result.error.details).toStrictEqual({ paymentId: waiting.id });
    });

    it('no longer blocks on a pending payment older than 15 min', async () => {
      const h = harness();
      await h.payments.insert(previous({ minutesAgo: 15 }, 1));
      const result = await h.useCase.execute(INPUT);
      expect(result.isOk()).toBe(true);
    });

    it('refuses the 6th attempt of the hour', async () => {
      const h = harness();
      for (let n = 1; n <= 5; n += 1) {
        await h.payments.insert(
          previous({ minutesAgo: 50 - n, status: 'failed', phone: `+23769900002${String(n)}` }, n),
        );
      }
      const result = await h.useCase.execute(INPUT);
      expect(result.error.code).toBe('RATE_LIMIT_PAYMENT_ATTEMPTS');
      expect(result.error.details).toStrictEqual({ reason: 'user_hourly_limit' });
    });

    it('refuses the 4th attempt of the day on the same number, whoever asks', async () => {
      const h = harness();
      for (let n = 1; n <= 3; n += 1) {
        await h.payments.insert(
          previous({ userId: `user-${String(n)}`, minutesAgo: 600, status: 'failed' }, n),
        );
      }
      const result = await h.useCase.execute(INPUT);
      expect(result.error.details).toStrictEqual({ reason: 'phone_daily_limit' });
      expect(h.gateway.collected).toHaveLength(0);
    });
  });
});
