import { paymentDescription } from './payment-description';

describe('paymentDescription', () => {
  it('names a pass by its duration', () => {
    expect(
      paymentDescription({
        code: 'pass-30d',
        kind: 'pass',
        priceXaf: 2000,
        units: 250_000,
        durationDays: 30,
      }),
    ).toBe('Voxlivre - Pass 30 jours');
  });

  it('names credits by their units, in plain ASCII', () => {
    const description = paymentDescription({
      code: 'credits-m',
      kind: 'credits',
      priceXaf: 1000,
      units: 110_000,
    });
    expect(description).toBe('Voxlivre - Credits 110000 unites');
    expect(description).toMatch(/^[\u0020-\u007E]+$/);
  });
});
