import { type GrantOfferUseCase } from '@/modules/billing/application/use-cases/grant-offer.use-case';
import { type ListOffersUseCase } from '@/modules/billing/application/use-cases/list-offers.use-case';
import { OfferNotFoundError } from '@/modules/billing/domain/errors/offer-not-found.error';
import { type Offer } from '@/modules/billing/domain/offer';
import { Money } from '@/modules/billing/domain/value-objects/money.vo';
import { Units } from '@/modules/billing/domain/value-objects/units.vo';
import { Result } from '@/shared/kernel';

import { BillingAdapter } from './billing.adapter';

const OFFERS: readonly Offer[] = [
  {
    code: 'pass-30d',
    kind: 'pass',
    price: Money.xaf(2000),
    units: Units.of(250_000),
    durationDays: 30,
    active: true,
  },
  {
    code: 'credits-s',
    kind: 'credits',
    price: Money.xaf(500),
    units: Units.of(50_000),
    active: true,
  },
];

function adapter(
  grantResult: Awaited<ReturnType<GrantOfferUseCase['execute']>> = Result.ok({
    granted: true,
    grant: {} as never,
  }),
) {
  const listOffers = {
    execute: jest.fn().mockResolvedValue({ offers: OFFERS, voiceTierWeights: {} }),
  } as unknown as ListOffersUseCase;
  const grantOffer = { execute: jest.fn().mockResolvedValue(grantResult) };
  return {
    billing: new BillingAdapter(listOffers, grantOffer as unknown as GrantOfferUseCase),
    grantOffer,
  };
}

describe('BillingAdapter', () => {
  it('describes a pass and credits offer in sale', async () => {
    const { billing } = adapter();
    expect(await billing.findOffer('pass-30d')).toStrictEqual({
      code: 'pass-30d',
      kind: 'pass',
      priceXaf: 2000,
      units: 250_000,
      durationDays: 30,
    });
    expect(await billing.findOffer('credits-s')).toStrictEqual({
      code: 'credits-s',
      kind: 'credits',
      priceXaf: 500,
      units: 50_000,
    });
  });

  it('finds nothing for an unknown or withdrawn offer (absent from the active list)', async () => {
    expect(await adapter().billing.findOffer('credits-xl')).toBeNull();
  });

  it('grants through billing with the payment reference', async () => {
    const { billing, grantOffer } = adapter();
    const input = { paymentReference: 'pay-1', userId: 'alice', offerCode: 'pass-30d' };
    const granted = await billing.grant(input);
    expect(granted.isOk()).toBe(true);
    expect(grantOffer.execute).toHaveBeenCalledWith(input);
  });

  it('passes billing errors through', async () => {
    const { billing } = adapter(Result.err(new OfferNotFoundError('gone')));
    const result = await billing.grant({
      paymentReference: 'pay-1',
      userId: 'alice',
      offerCode: 'gone',
    });
    expect(result.error.code).toBe('OFFER_NOT_FOUND');
  });
});
