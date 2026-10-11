import { HmacDestinationHasher } from '../../../notification/infrastructure/security/hmac-destination-hasher';
import { MobileMoneyNumber } from '../../domain/value-objects/mobile-money-number.vo';

import { HmacPhoneHasher } from './hmac-phone-hasher';

const SECRET = 'x'.repeat(32);
const PHONE = MobileMoneyNumber.of('+237699000012').value;

describe('HmacPhoneHasher', () => {
  it('is stable and 64 hex characters long', () => {
    const hasher = new HmacPhoneHasher(SECRET);
    expect(hasher.keyOf(PHONE)).toMatch(/^[0-9a-f]{64}$/);
    expect(hasher.keyOf(PHONE)).toBe(new HmacPhoneHasher(SECRET).keyOf(PHONE));
  });

  it('differs from one number to another, and from one secret to another', () => {
    const hasher = new HmacPhoneHasher(SECRET);
    expect(hasher.keyOf(PHONE)).not.toBe(hasher.keyOf(MobileMoneyNumber.of('+237699000013').value));
    expect(new HmacPhoneHasher('y'.repeat(32)).keyOf(PHONE)).not.toBe(hasher.keyOf(PHONE));
  });

  it('does not match the sign-in code log for the same number (own derivation label)', () => {
    expect(new HmacPhoneHasher(SECRET).keyOf(PHONE)).not.toBe(
      new HmacDestinationHasher(SECRET).keyOf(PHONE),
    );
  });
});
