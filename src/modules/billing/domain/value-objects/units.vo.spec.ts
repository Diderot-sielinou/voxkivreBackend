import { Money } from './money.vo';
import { Units } from './units.vo';

describe('Units', () => {
  it('weights a natural voice ×4 and a standard voice ×1', () => {
    expect(Units.forChars(1000, 'standard')).toBe(1000);
    expect(Units.forChars(1000, 'natural')).toBe(4000);
  });

  it.each([-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])('rejects %p', (value) => {
    expect(() => Units.of(value)).toThrow(RangeError);
  });
});

describe('Money', () => {
  it('holds whole XAF amounts', () => {
    expect(Money.xaf(2000)).toBe(2000);
    expect(Money.xaf(0)).toBe(0);
  });

  it.each([-500, 99.5, Number.NaN])('rejects %p', (value) => {
    expect(() => Money.xaf(value)).toThrow(RangeError);
  });
});
