import { DEFAULT_OFFERS } from '../../../../../../test/support/fakes';

import {
  toBillingAccountResponseDto,
  toOfferListResponseDto,
  toWalletEntryListResponseDto,
} from './billing.mapper';

describe('billing mappers', () => {
  it('maps the catalogue, with no duration for credits', () => {
    const dto = toOfferListResponseDto({
      offers: DEFAULT_OFFERS.slice(0, 2),
      voiceTierWeights: { standard: 1, natural: 4 },
    });
    expect(dto).toEqual({
      items: [
        { code: 'pass-30d', kind: 'pass', priceXaf: 2000, units: 250_000, durationDays: 30 },
        { code: 'credits-s', kind: 'credits', priceXaf: 500, units: 50_000, durationDays: null },
      ],
      voiceTierWeights: { standard: 1, natural: 4 },
    });
  });

  it('maps the account with ISO dates, or nulls without a pass', () => {
    const base = {
      period: '2026-10',
      free: { limit: 50_000, used: 0, remaining: 50_000 },
      credits: 0,
      maxCharsPerConversion: 1_000_000,
    };
    expect(toBillingAccountResponseDto({ ...base, pass: null, nextPassStartsAt: null })).toEqual({
      ...base,
      pass: null,
      nextPassStartsAt: null,
    });
    const end = new Date('2026-11-09T12:00:00Z');
    expect(
      toBillingAccountResponseDto({
        ...base,
        pass: { endsAt: end, includedUnits: 10, usedUnits: 4, remainingUnits: 6 },
        nextPassStartsAt: end,
      }),
    ).toMatchObject({
      pass: { endsAt: '2026-11-09T12:00:00.000Z', remainingUnits: 6 },
      nextPassStartsAt: '2026-11-09T12:00:00.000Z',
    });
  });

  it('exposes the reservation as the conversion id', () => {
    const dto = toWalletEntryListResponseDto({
      items: [
        {
          id: 'e1',
          kind: 'consumption',
          units: -400,
          createdAt: new Date('2026-10-10T12:00:00Z'),
          offerCode: null,
          reservationId: 'conv-1',
        },
      ],
      nextCursor: null,
    });
    expect(dto.items[0]).toEqual({
      id: 'e1',
      kind: 'consumption',
      units: -400,
      createdAt: '2026-10-10T12:00:00.000Z',
      offerCode: null,
      conversionId: 'conv-1',
    });
  });
});
