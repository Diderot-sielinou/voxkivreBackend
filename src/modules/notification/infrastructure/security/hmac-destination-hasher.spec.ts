import { HmacDestinationHasher } from './hmac-destination-hasher';

describe('HmacDestinationHasher', () => {
  it('is stable, case-insensitive for e-mails, and depends on the secret', () => {
    const hasher = new HmacDestinationHasher('s'.repeat(40));
    const key = hasher.keyOf('+237699000012');
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(hasher.keyOf('+237699000012')).toBe(key);
    expect(key).not.toContain('237699');
    expect(hasher.keyOf('Alice@X.cm')).toBe(hasher.keyOf('alice@x.cm'));
    expect(new HmacDestinationHasher('t'.repeat(40)).keyOf('+237699000012')).not.toBe(key);
  });
});
