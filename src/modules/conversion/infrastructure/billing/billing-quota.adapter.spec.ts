import { RefundQuotaUseCase } from '@/modules/billing/application/use-cases/refund-quota.use-case';
import { ReserveQuotaUseCase } from '@/modules/billing/application/use-cases/reserve-quota.use-case';

import {
  FixedClock,
  ImmediateUnitOfWork,
  InMemoryQuotaLedger,
} from '../../../../../test/support/fakes';

import { BillingQuotaAdapter } from './billing-quota.adapter';

describe('BillingQuotaAdapter', () => {
  it('reserves and refunds through the billing use-cases', async () => {
    const ledger = new InMemoryQuotaLedger();
    const uow = new ImmediateUnitOfWork();
    const clock = new FixedClock(new Date('2026-10-06T10:00:00Z'));
    const policy = { freeTierCharsPerMonth: 100, maxCharsPerConversion: 1000 };
    const quota = new BillingQuotaAdapter(
      new ReserveQuotaUseCase(ledger, policy, uow, clock),
      new RefundQuotaUseCase(ledger, uow, clock),
    );
    const reserved = await quota.reserve({ reservationId: 'c1', userId: 'alice', chars: 80 });
    expect(reserved.isOk()).toBe(true);
    const refused = await quota.reserve({ reservationId: 'c2', userId: 'alice', chars: 30 });
    expect(refused.error.code).toBe('QUOTA_EXCEEDED');
    await quota.refund('c1', 50);
    expect(ledger.usageByKey.get('alice|2026-10')).toBe(30);
  });
});
