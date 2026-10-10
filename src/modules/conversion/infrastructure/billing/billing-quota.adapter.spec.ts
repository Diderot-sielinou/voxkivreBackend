import { RefundQuotaUseCase } from '@/modules/billing/application/use-cases/refund-quota.use-case';
import { ReserveQuotaUseCase } from '@/modules/billing/application/use-cases/reserve-quota.use-case';

import {
  FixedClock,
  ImmediateUnitOfWork,
  InMemoryBilling,
} from '../../../../../test/support/fakes';

import { BillingQuotaAdapter } from './billing-quota.adapter';

describe('BillingQuotaAdapter', () => {
  it('reserves with the voice tier and refunds through the billing use-cases', async () => {
    const billing = new InMemoryBilling();
    const uow = new ImmediateUnitOfWork();
    const clock = new FixedClock(new Date('2026-10-06T10:00:00Z'));
    const policy = { freeTierUnitsPerMonth: 100, maxCharsPerConversion: 1000 };
    const quota = new BillingQuotaAdapter(
      new ReserveQuotaUseCase(billing, policy, uow, clock),
      new RefundQuotaUseCase(billing, uow, clock),
    );
    const reserved = await quota.reserve({
      reservationId: 'c1',
      userId: 'alice',
      chars: 80,
      voiceTier: 'standard',
    });
    expect(reserved.isOk()).toBe(true);
    // Voix naturelle : le gratuit ne la finance pas.
    const refused = await quota.reserve({
      reservationId: 'c2',
      userId: 'alice',
      chars: 10,
      voiceTier: 'natural',
    });
    expect(refused.error.code).toBe('QUOTA_EXCEEDED');
    await quota.refund('c1', 50);
    expect(billing.freeUsed.get('alice|2026-10')).toBe(30);
  });
});
