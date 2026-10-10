import { IDENTITY_ERROR_CODES } from '../errors/error-codes';

import { PhoneNumber } from './phone-number.vo';

describe('PhoneNumber', () => {
  it.each(['+237699000000', '+33612345678', '+12025550123'])('accepts E.164 %s', (raw) => {
    expect(PhoneNumber.of(raw).value).toBe(raw);
  });

  it('normalises spaces, dots, dashes and parentheses', () => {
    expect(PhoneNumber.of('+237 6 99-00.00 (00)').value).toBe('+237699000000');
  });

  it.each(['699000000', '+0123456789', '+237', '+2376990000001234', 'abc'])('rejects %s', (raw) => {
    const r = PhoneNumber.of(raw);
    expect(r.isErr()).toBe(true);
    expect(r.error.code).toBe(IDENTITY_ERROR_CODES.INVALID_PHONE_NUMBER);
  });
});

describe('PhoneNumber.isCameroonMobile', () => {
  it('accepts Cameroonian mobiles only (ADR-0017)', () => {
    expect(PhoneNumber.isCameroonMobile('+237699000012')).toBe(true);
    expect(PhoneNumber.isCameroonMobile('+237 6 77 00 00 01')).toBe(true);
    expect(PhoneNumber.isCameroonMobile('+237222123456')).toBe(false); // fixe
    expect(PhoneNumber.isCameroonMobile('+23769900001')).toBe(false); // trop court
    expect(PhoneNumber.isCameroonMobile('+33612345678')).toBe(false); // étranger
    expect(PhoneNumber.isCameroonMobile('699000012')).toBe(false); // pas E.164
  });
});
