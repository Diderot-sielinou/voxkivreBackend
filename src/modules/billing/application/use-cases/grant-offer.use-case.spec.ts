import {
  FixedClock,
  ImmediateUnitOfWork,
  InMemoryBilling,
} from '../../../../../test/support/fakes';
import { BILLING_ERROR_CODES } from '../../domain/errors/error-codes';

import { GetBillingAccountUseCase } from './get-billing-account.use-case';
import { GrantOfferUseCase } from './grant-offer.use-case';

const DAY_MS = 24 * 60 * 60 * 1000;

function setup() {
  const billing = new InMemoryBilling();
  const clock = new FixedClock(new Date('2026-10-10T12:00:00Z'));
  const policy = { freeTierUnitsPerMonth: 1000, maxCharsPerConversion: 1000 };
  return {
    billing,
    clock,
    grant: new GrantOfferUseCase(billing, billing, new ImmediateUnitOfWork(), clock),
    account: new GetBillingAccountUseCase(billing, policy, clock),
  };
}

describe('GrantOfferUseCase', () => {
  it('adds credits to the wallet and journals the purchase', async () => {
    const { grant, account, billing } = setup();
    const result = await grant.execute({
      userId: 'alice',
      offerCode: 'credits-m',
      paymentReference: 'pay-1',
    });
    expect(result.value).toMatchObject({
      granted: true,
      grant: { kind: 'credits', units: 110_000 },
    });
    expect(await account.execute('alice')).toMatchObject({ credits: 110_000 });
    expect(billing.entries).toMatchObject([
      { kind: 'purchase', units: 110_000, offerCode: 'credits-m' },
    ]);
  });

  it('never grants the same payment twice (RNF-09)', async () => {
    const { grant, account } = setup();
    const input = { userId: 'alice', offerCode: 'credits-s', paymentReference: 'pay-1' };
    await grant.execute(input);
    const again = await grant.execute(input);
    expect(again.value).toMatchObject({ granted: false, grant: { units: 50_000 } });
    expect(await account.execute('alice')).toMatchObject({ credits: 50_000 });
  });

  it('refuses a payment reference replayed for another user or offer (409)', async () => {
    const { grant } = setup();
    await grant.execute({ userId: 'alice', offerCode: 'credits-s', paymentReference: 'pay-1' });
    const otherUser = await grant.execute({
      userId: 'bob',
      offerCode: 'credits-s',
      paymentReference: 'pay-1',
    });
    const otherOffer = await grant.execute({
      userId: 'alice',
      offerCode: 'credits-l',
      paymentReference: 'pay-1',
    });
    expect(otherUser.error.code).toBe(BILLING_ERROR_CODES.PAYMENT_REFERENCE_CONFLICT);
    expect(otherOffer.error.code).toBe(BILLING_ERROR_CODES.PAYMENT_REFERENCE_CONFLICT);
  });

  it('answers "already granted" when a concurrent replay wins the race', async () => {
    const { grant, billing, account } = setup();
    const input = { userId: 'alice', offerCode: 'credits-s', paymentReference: 'pay-1' };
    await grant.execute(input);
    // La relecture initiale passe avant que l'autre requête n'ait écrit.
    jest.spyOn(billing, 'findPurchase').mockResolvedValueOnce(null);
    const replay = await grant.execute(input);
    expect(replay.value).toMatchObject({ granted: false });
    expect(await account.execute('alice')).toMatchObject({ credits: 50_000 });
  });

  it('refuses an unknown offer (404)', async () => {
    const { grant } = setup();
    const result = await grant.execute({
      userId: 'alice',
      offerCode: 'nope',
      paymentReference: 'pay-1',
    });
    expect(result.error.code).toBe(BILLING_ERROR_CODES.OFFER_NOT_FOUND);
  });

  it('starts a pass now, and an early renewal at the end of the running one', async () => {
    const { grant, account, clock } = setup();
    await grant.execute({ userId: 'alice', offerCode: 'pass-30d', paymentReference: 'pay-1' });
    clock.advance(20 * DAY_MS);
    const renewal = await grant.execute({
      userId: 'alice',
      offerCode: 'pass-30d',
      paymentReference: 'pay-2',
    });
    expect(renewal.value.grant).toMatchObject({
      startsAt: new Date('2026-11-09T12:00:00Z'),
      endsAt: new Date('2026-12-09T12:00:00Z'),
    });
    expect(await account.execute('alice')).toMatchObject({
      pass: { endsAt: new Date('2026-11-09T12:00:00Z'), remainingUnits: 250_000 },
      nextPassStartsAt: new Date('2026-11-09T12:00:00Z'),
    });
  });
});
