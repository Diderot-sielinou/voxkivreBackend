import { ERROR_CODES } from './error-codes';
import { IdempotencyKey, idempotencyHashOf } from './idempotency';

describe('IdempotencyKey.of', () => {
  it('accepts a UUID', () => {
    const r = IdempotencyKey.of('6ba7b810-9dad-11d1-80b4-00c04fd430c8');
    expect(r.isOk()).toBe(true);
  });

  it('accepts an alphanumeric key and trims it', () => {
    const r = IdempotencyKey.of('  conv_abc-123  ');
    expect(r.value).toBe('conv_abc-123');
  });

  it('rejects too short keys with details', () => {
    const r = IdempotencyKey.of('short');
    expect(r.isErr()).toBe(true);
    expect(r.error.code).toBe(ERROR_CODES.INVALID_IDEMPOTENCY_KEY);
    expect(r.error.details).toEqual({ length: 5 });
  });

  it('rejects invalid characters', () => {
    expect(IdempotencyKey.of('has spaces here').isErr()).toBe(true);
  });

  it('generate() returns a valid key', () => {
    expect(IdempotencyKey.of(IdempotencyKey.generate()).isOk()).toBe(true);
  });
});

describe('idempotencyHashOf', () => {
  it('is stable under key permutation', () => {
    expect(idempotencyHashOf({ a: 1, b: [1, 2] })).toBe(idempotencyHashOf({ b: [1, 2], a: 1 }));
  });

  it('distinguishes types', () => {
    expect(idempotencyHashOf({ a: 1 })).not.toBe(idempotencyHashOf({ a: '1' }));
  });

  it('handles bigint and null', () => {
    expect(idempotencyHashOf({ n: 10n, x: null })).toHaveLength(64);
  });
});
