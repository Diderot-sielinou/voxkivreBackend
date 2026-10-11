import { createHmac } from 'node:crypto';

import { checkHs256Jwt, isValidHs256Jwt } from './hs256-jwt';

const KEY = 'webhook-key';
const NOW = 1_800_000_000;

function segment(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function sign(
  claims: Record<string, unknown>,
  options: { key?: string; header?: Record<string, unknown> } = {},
): string {
  const unsigned = `${segment(options.header ?? { typ: 'JWT', alg: 'HS256' })}.${segment(claims)}`;
  return `${unsigned}.${hmac(unsigned, options.key ?? KEY)}`;
}

function hmac(unsigned: string, key: string): string {
  return createHmac('sha256', key).update(unsigned).digest('base64url');
}

describe('isValidHs256Jwt', () => {
  it('accepts a token signed with the key', () => {
    expect(isValidHs256Jwt(sign({ iat: NOW - 10 }), KEY, NOW)).toBe(true);
  });

  it('accepts a token without exp nor nbf', () => {
    expect(isValidHs256Jwt(sign({}), KEY, NOW)).toBe(true);
  });

  it('rejects a token signed with another key', () => {
    expect(isValidHs256Jwt(sign({}, { key: 'other' }), KEY, NOW)).toBe(false);
  });

  it('rejects a token whose claims were altered after signing', () => {
    const [h, , s] = sign({ amount: 25 }).split('.');
    expect(isValidHs256Jwt(`${h}.${segment({ amount: 2000 })}.${s}`, KEY, NOW)).toBe(false);
  });

  it.each([
    ['none', { alg: 'none' }],
    ['RS256', { alg: 'RS256' }],
    ['a missing alg', { typ: 'JWT' }],
  ])('rejects a header declaring %s, even if the HMAC matches', (_label, headerValue) => {
    expect(isValidHs256Jwt(sign({}, { header: headerValue }), KEY, NOW)).toBe(false);
  });

  it('rejects an expired token, and accepts it just before', () => {
    expect(isValidHs256Jwt(sign({ exp: NOW }), KEY, NOW)).toBe(false);
    expect(isValidHs256Jwt(sign({ exp: NOW + 1 }), KEY, NOW)).toBe(true);
  });

  it('rejects a token not yet valid', () => {
    expect(isValidHs256Jwt(sign({ nbf: NOW + 1 }), KEY, NOW)).toBe(false);
  });

  it.each([
    ['empty', ''],
    ['two parts', 'a.b'],
    ['four parts', 'a.b.c.d'],
    ['garbage', 'not.a.jwt'],
  ])('rejects a %s token', (_label, token) => {
    expect(isValidHs256Jwt(token, KEY, NOW)).toBe(false);
  });

  it('rejects a correctly signed token whose header is not JSON', () => {
    const unsigned = `${Buffer.from('nope').toString('base64url')}.${segment({})}`;
    expect(isValidHs256Jwt(`${unsigned}.${hmac(unsigned, KEY)}`, KEY, NOW)).toBe(false);
  });

  it.each([
    ['malformed', 'a.b'],
    ['bad_signature', sign({}, { key: 'other' })],
    ['unsupported_alg', sign({}, { header: { alg: 'none' } })],
    ['expired', sign({ exp: NOW })],
    ['not_yet_valid', sign({ nbf: NOW + 1 })],
    ['valid', sign({ exp: NOW + 3600, nbf: NOW })],
  ])('tells why a token is refused (%s), for our logs only', (reason, token) => {
    expect(checkHs256Jwt(token, KEY, NOW)).toBe(reason);
  });
});
