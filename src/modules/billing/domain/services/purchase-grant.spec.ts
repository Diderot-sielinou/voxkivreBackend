import { type CreditsOffer, type PassOffer } from '../offer';
import { Money } from '../value-objects/money.vo';
import { Units } from '../value-objects/units.vo';

import { grantFor } from './purchase-grant';

const pass: PassOffer = {
  code: 'pass-30d',
  kind: 'pass',
  price: Money.xaf(2000),
  units: Units.of(250_000),
  durationDays: 30,
  active: true,
};

const credits: CreditsOffer = {
  code: 'credits-m',
  kind: 'credits',
  price: Money.xaf(1000),
  units: Units.of(110_000),
  active: true,
};

const now = new Date('2026-10-10T12:00:00Z');

describe('grantFor', () => {
  it('grants credits as a snapshot of the offer', () => {
    expect(grantFor(credits, now, null)).toEqual({
      kind: 'credits',
      offerCode: 'credits-m',
      price: 1000,
      units: 110_000,
    });
  });

  it('starts a first pass now, for its duration', () => {
    expect(grantFor(pass, now, null)).toEqual({
      kind: 'pass',
      offerCode: 'pass-30d',
      price: 2000,
      units: 250_000,
      startsAt: now,
      endsAt: new Date('2026-11-09T12:00:00Z'),
    });
  });

  it('starts a renewal at the end of the running pass: no day lost', () => {
    const runningEnd = new Date('2026-10-20T08:00:00Z');
    const grant = grantFor(pass, now, runningEnd);
    expect(grant).toMatchObject({
      startsAt: runningEnd,
      endsAt: new Date('2026-11-19T08:00:00Z'),
    });
  });

  it('starts now when the last pass is already over', () => {
    expect(grantFor(pass, now, new Date('2026-10-01T00:00:00Z'))).toMatchObject({ startsAt: now });
  });
});
