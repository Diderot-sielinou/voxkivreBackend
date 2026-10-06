import { resolveCursorSecret } from './cursor-secret';

describe('resolveCursorSecret', () => {
  const authSecret = 'a'.repeat(40);

  it('uses CURSOR_HMAC_SECRET when provided', () => {
    const secret = 'c'.repeat(32);
    expect(
      resolveCursorSecret({ CURSOR_HMAC_SECRET: secret, BETTER_AUTH_SECRET: authSecret }),
    ).toBe(secret);
  });

  it('derives a deterministic ≥ 32-char secret distinct from BETTER_AUTH_SECRET otherwise', () => {
    const env = { CURSOR_HMAC_SECRET: undefined, BETTER_AUTH_SECRET: authSecret };
    const derived = resolveCursorSecret(env);
    expect(derived).toBe(resolveCursorSecret(env));
    expect(derived).not.toBe(authSecret);
    expect(derived.length).toBeGreaterThanOrEqual(32);
  });
});
