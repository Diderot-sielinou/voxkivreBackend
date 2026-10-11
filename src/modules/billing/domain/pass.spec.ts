import { isPassActiveAt, remainingPassUnits } from './pass';
import { Units } from './value-objects/units.vo';

const period = {
  startsAt: new Date('2026-10-10T00:00:00Z'),
  endsAt: new Date('2026-11-09T00:00:00Z'),
};

describe('Pass', () => {
  it('is active from its start (inclusive) to its end (exclusive)', () => {
    expect(isPassActiveAt(period, new Date('2026-10-09T23:59:59Z'))).toBe(false);
    expect(isPassActiveAt(period, period.startsAt)).toBe(true);
    expect(isPassActiveAt(period, new Date('2026-11-08T23:59:59Z'))).toBe(true);
    expect(isPassActiveAt(period, period.endsAt)).toBe(false);
  });

  it('reports the units left, never below zero', () => {
    expect(remainingPassUnits({ includedUnits: Units.of(100), usedUnits: Units.of(30) })).toBe(70);
    expect(remainingPassUnits({ includedUnits: Units.of(100), usedUnits: Units.of(100) })).toBe(0);
  });
});
