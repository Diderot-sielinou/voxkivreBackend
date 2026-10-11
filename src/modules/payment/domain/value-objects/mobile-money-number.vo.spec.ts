import { MobileMoneyNumber } from './mobile-money-number.vo';

describe('MobileMoneyNumber', () => {
  it.each([
    ['+237699000012', '+237699000012'],
    ['+237 6 99-00.00 (12)', '+237699000012'],
    ['237699000012', '+237699000012'],
    ['699000012', '+237699000012'],
    ['6 77 12 34 56', '+237677123456'],
  ])('accepts %s as %s', (raw, expected) => {
    const parsed = MobileMoneyNumber.of(raw);
    expect(parsed.isOk()).toBe(true);
    expect(parsed.value).toBe(expected);
  });

  it.each([
    ['a landline', '+237222123456'],
    ['a short number', '+23769900001'],
    ['a long number', '+2376990000123'],
    ['a foreign mobile', '+33612345678'],
    ['a local number without the leading 6', '222123456'],
    ['letters', 'abc'],
    ['nothing', ''],
  ])('rejects %s', (_label, raw) => {
    const parsed = MobileMoneyNumber.of(raw);
    expect(parsed.isErr()).toBe(true);
    expect(parsed.error.code).toBe('INVALID_PAYMENT_PHONE');
  });

  it('gives the provider format without the plus sign', () => {
    const phone = MobileMoneyNumber.of('+237699000012').value;
    expect(MobileMoneyNumber.digits(phone)).toBe('237699000012');
  });

  it('keeps only the last two digits for display', () => {
    const phone = MobileMoneyNumber.of('+237699000047').value;
    expect(MobileMoneyNumber.suffix(phone)).toBe('47');
  });
});
