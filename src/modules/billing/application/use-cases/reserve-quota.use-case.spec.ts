import {
  FixedClock,
  ImmediateUnitOfWork,
  InMemoryBilling,
} from '../../../../../test/support/fakes';
import { BILLING_ERROR_CODES } from '../../domain/errors/error-codes';

import { GetBillingAccountUseCase } from './get-billing-account.use-case';
import { GrantOfferUseCase } from './grant-offer.use-case';
import { RefundQuotaUseCase } from './refund-quota.use-case';
import { ReserveQuotaUseCase } from './reserve-quota.use-case';

const POLICY = { freeTierUnitsPerMonth: 1000, maxCharsPerConversion: 300_000 };

function setup() {
  const billing = new InMemoryBilling();
  const uow = new ImmediateUnitOfWork();
  const clock = new FixedClock(new Date('2026-10-06T10:00:00Z'));
  return {
    billing,
    uow,
    clock,
    reserve: new ReserveQuotaUseCase(billing, POLICY, uow, clock),
    refund: new RefundQuotaUseCase(billing, uow, clock),
    grant: new GrantOfferUseCase(billing, billing, uow, clock),
    account: new GetBillingAccountUseCase(billing, POLICY, clock),
  };
}

describe('ReserveQuotaUseCase / RefundQuotaUseCase', () => {
  it('reserves a standard voice on the free tier, inside a transaction', async () => {
    const { reserve, account, uow } = setup();
    const result = await reserve.execute({
      reservationId: 'c1',
      userId: 'alice',
      chars: 600,
      tier: 'standard',
    });
    expect(result.value).toMatchObject({ taken: { free: 600, pass: 0, credits: 0 } });
    expect(uow.calls).toBe(1);
    expect(await account.execute('alice')).toMatchObject({
      period: '2026-10',
      free: { limit: 1000, used: 600, remaining: 400 },
      pass: null,
      credits: 0,
    });
  });

  it('debits an operation once, even when reserved twice', async () => {
    const { reserve, account } = setup();
    const input = { reservationId: 'c1', userId: 'alice', chars: 300, tier: 'standard' } as const;
    await reserve.execute(input);
    const again = await reserve.execute(input);
    expect(again.isOk()).toBe(true);
    expect(await account.execute('alice')).toMatchObject({ free: { used: 300 } });
  });

  it('refuses a natural voice on the free tier alone, saying what could be used', async () => {
    const { reserve, account } = setup();
    const result = await reserve.execute({
      reservationId: 'c1',
      userId: 'alice',
      chars: 100,
      tier: 'natural',
    });
    expect(result.error).toMatchObject({
      code: BILLING_ERROR_CODES.QUOTA_EXCEEDED,
      details: {
        requested: 400,
        usable: 0,
        tier: 'natural',
        available: { free: 1000, pass: 0, credits: 0 },
        period: '2026-10',
      },
    });
    expect(await account.execute('alice')).toMatchObject({ free: { used: 0 } });
  });

  it('refuses above the per-conversion cap, in characters (422)', async () => {
    const { reserve } = setup();
    const result = await reserve.execute({
      reservationId: 'c1',
      userId: 'alice',
      chars: 300_001,
      tier: 'standard',
    });
    expect(result.error.code).toBe(BILLING_ERROR_CODES.QUOTA_CONVERSION_LIMIT_EXCEEDED);
  });

  it('spills over free → pass → credits, then refunds credits → pass → free', async () => {
    const { reserve, refund, grant, account, billing } = setup();
    await grant.execute({ userId: 'alice', offerCode: 'pass-30d', paymentReference: 'pay-1' });
    await grant.execute({ userId: 'alice', offerCode: 'credits-s', paymentReference: 'pay-2' });

    // 1 000 gratuit + 250 000 pass + 50 000 crédits ; 251 500 caractères standard.
    const reserved = await reserve.execute({
      reservationId: 'c1',
      userId: 'alice',
      chars: 251_500,
      tier: 'standard',
    });
    expect(reserved.value.taken).toEqual({ free: 1000, pass: 250_000, credits: 500 });
    expect(await account.execute('alice')).toMatchObject({
      free: { remaining: 0 },
      pass: { remainingUnits: 0 },
      credits: 49_500,
    });

    // 1 000 caractères non synthétisés : 500 rendus aux crédits, 500 au pass.
    expect(await refund.execute('c1', 1000)).toBe(true);
    expect(await account.execute('alice')).toMatchObject({
      free: { remaining: 0 },
      pass: { remainingUnits: 500 },
      credits: 50_000,
    });
    expect(billing.entries.map((e) => [e.kind, e.units])).toEqual([
      ['purchase', 50_000],
      ['consumption', -500],
      ['refund', 500],
    ]);
  });

  it('weights a natural voice ×4 against the pass and credits', async () => {
    const { reserve, grant } = setup();
    await grant.execute({ userId: 'alice', offerCode: 'credits-s', paymentReference: 'pay-1' });
    const reserved = await reserve.execute({
      reservationId: 'c1',
      userId: 'alice',
      chars: 10_000,
      tier: 'natural',
    });
    expect(reserved.value.taken).toEqual({ free: 0, pass: 0, credits: 40_000 });
  });

  it('refunds a reservation once, and never more than was reserved', async () => {
    const { reserve, refund, account } = setup();
    await reserve.execute({ reservationId: 'c1', userId: 'alice', chars: 400, tier: 'standard' });
    expect(await refund.execute('c1', 10_000)).toBe(true);
    expect(await refund.execute('c1', 400)).toBe(false);
    expect(await refund.execute('unknown', 10)).toBe(false);
    expect(await refund.execute('c1', 0)).toBe(false);
    expect(await account.execute('alice')).toMatchObject({ free: { used: 0 } });
  });
});
