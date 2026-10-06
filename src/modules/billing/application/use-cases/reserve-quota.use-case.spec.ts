import {
  FixedClock,
  ImmediateUnitOfWork,
  InMemoryQuotaLedger,
} from '../../../../../test/support/fakes';
import { BILLING_ERROR_CODES } from '../../domain/errors/error-codes';

import { GetQuotaUseCase } from './get-quota.use-case';
import { RefundQuotaUseCase } from './refund-quota.use-case';
import { ReserveQuotaUseCase } from './reserve-quota.use-case';

const POLICY = { freeTierCharsPerMonth: 1000, maxCharsPerConversion: 800 };

function setup() {
  const ledger = new InMemoryQuotaLedger();
  const uow = new ImmediateUnitOfWork();
  const clock = new FixedClock(new Date('2026-10-06T10:00:00Z'));
  return {
    ledger,
    uow,
    clock,
    reserve: new ReserveQuotaUseCase(ledger, POLICY, uow, clock),
    refund: new RefundQuotaUseCase(ledger, uow, clock),
    status: new GetQuotaUseCase(ledger, POLICY, clock),
  };
}

describe('quota use-cases', () => {
  it('reserves within the monthly limit, inside a transaction', async () => {
    const { reserve, status, uow } = setup();
    const result = await reserve.execute({ reservationId: 'c1', userId: 'alice', chars: 600 });
    expect(result.value).toEqual({ period: '2026-10', reservedChars: 600 });
    expect(uow.calls).toBe(1);
    expect(await status.execute('alice')).toEqual({
      period: '2026-10',
      limit: 1000,
      used: 600,
      remaining: 400,
      maxCharsPerConversion: 800,
    });
  });

  it('debits an operation once, even when reserved twice', async () => {
    const { reserve, status } = setup();
    await reserve.execute({ reservationId: 'c1', userId: 'alice', chars: 300 });
    const again = await reserve.execute({ reservationId: 'c1', userId: 'alice', chars: 300 });
    expect(again.isOk()).toBe(true);
    expect(await status.execute('alice')).toMatchObject({ used: 300 });
  });

  it('refuses beyond the remaining quota with what is left (402 QUOTA_EXCEEDED)', async () => {
    const { reserve, status } = setup();
    await reserve.execute({ reservationId: 'c1', userId: 'alice', chars: 700 });
    const result = await reserve.execute({ reservationId: 'c2', userId: 'alice', chars: 400 });
    expect(result.error).toMatchObject({
      code: BILLING_ERROR_CODES.QUOTA_EXCEEDED,
      details: { requested: 400, remaining: 300, limit: 1000, period: '2026-10' },
    });
    expect(await status.execute('alice')).toMatchObject({ used: 700 });
  });

  it('refuses a conversion above the per-conversion cap before touching the ledger', async () => {
    const { reserve, uow } = setup();
    const result = await reserve.execute({ reservationId: 'c1', userId: 'alice', chars: 801 });
    expect(result.error).toMatchObject({
      code: BILLING_ERROR_CODES.QUOTA_CONVERSION_LIMIT_EXCEEDED,
      details: { requested: 801, maxChars: 800 },
    });
    expect(uow.calls).toBe(0);
  });

  it('never lets a single request exceed the monthly limit, even on an empty month', async () => {
    const policy = { freeTierCharsPerMonth: 100, maxCharsPerConversion: 800 };
    const ledger = new InMemoryQuotaLedger();
    const uow = new ImmediateUnitOfWork();
    const clock = new FixedClock(new Date('2026-10-06T10:00:00Z'));
    const result = await new ReserveQuotaUseCase(ledger, policy, uow, clock).execute({
      reservationId: 'c1',
      userId: 'alice',
      chars: 101,
    });
    expect(result.error).toMatchObject({ details: { remaining: 100 } });
    expect(uow.calls).toBe(0);
  });

  it('refunds once, at most the reserved amount, and ignores empty refunds', async () => {
    const { reserve, refund, status } = setup();
    await reserve.execute({ reservationId: 'c1', userId: 'alice', chars: 500 });
    expect(await refund.execute('c1', 0)).toBe(false);
    expect(await refund.execute('c1', 9999)).toBe(true);
    expect(await refund.execute('c1', 200)).toBe(false);
    expect(await status.execute('alice')).toMatchObject({ used: 0 });
  });

  it('starts every calendar month from zero', async () => {
    const { reserve, status, clock } = setup();
    await reserve.execute({ reservationId: 'c1', userId: 'alice', chars: 800 });
    clock.advance(30 * 24 * 60 * 60 * 1000);
    expect(await status.execute('alice')).toMatchObject({ period: '2026-11', used: 0 });
  });
});
