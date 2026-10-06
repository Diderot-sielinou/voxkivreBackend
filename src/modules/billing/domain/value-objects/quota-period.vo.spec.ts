import { QuotaPeriod } from './quota-period.vo';

describe('QuotaPeriod', () => {
  it('is the UTC calendar month', () => {
    expect(QuotaPeriod.at(new Date('2026-10-06T10:00:00Z'))).toBe('2026-10');
    expect(QuotaPeriod.at(new Date('2026-01-31T23:59:59Z'))).toBe('2026-01');
    // 00:30 à Douala le 1er novembre = encore octobre en UTC.
    expect(QuotaPeriod.at(new Date('2026-10-31T23:30:00Z'))).toBe('2026-10');
  });
});
