import { type GetBillingAccountUseCase } from '@/modules/billing/application/use-cases/get-billing-account.use-case';

import { BillingPaidAccess } from './billing-paid-access.adapter';

function accountWith(pass: boolean, credits: number): GetBillingAccountUseCase {
  return {
    execute: () =>
      Promise.resolve({
        period: '2026-10',
        free: { limit: 50_000, used: 0, remaining: 50_000 },
        pass: pass
          ? { endsAt: new Date(), includedUnits: 1, usedUnits: 1, remainingUnits: 0 }
          : null,
        nextPassStartsAt: null,
        credits,
        maxCharsPerConversion: 1_000_000,
      }),
  } as unknown as GetBillingAccountUseCase;
}

describe('BillingPaidAccess', () => {
  it.each([
    [false, 0, false],
    [true, 0, true], // un pass en cours, même épuisé
    [false, 10, true],
  ])('pass %s, credits %i → paid access %s', async (pass, credits, expected) => {
    expect(await new BillingPaidAccess(accountWith(pass, credits)).hasPaidAccess('u1')).toBe(
      expected,
    );
  });
});
