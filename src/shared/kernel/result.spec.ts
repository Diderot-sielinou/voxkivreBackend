import { Result } from './result';

describe('Result', () => {
  it('wraps a value in Ok', () => {
    const r = Result.ok(42);
    expect(r.isOk()).toBe(true);
    expect(r.isErr()).toBe(false);
    expect(r.value).toBe(42);
  });

  it('wraps an error in Err', () => {
    const r = Result.err<number, string>('boom');
    expect(r.isErr()).toBe(true);
    expect(r.error).toBe('boom');
  });

  it('throws when reading value on Err', () => {
    const r = Result.err('boom');
    expect(() => r.value).toThrow(/guard with isOk/);
  });

  it('throws when reading error on Ok', () => {
    const r = Result.ok(1);
    expect(() => r.error).toThrow(/guard with isErr/);
  });

  it('maps Ok and passes Err through', () => {
    expect(Result.ok(2).map((n) => n * 2).value).toBe(4);
    const err = Result.err<number, string>('e').map((n) => n * 2);
    expect(err.isErr()).toBe(true);
    expect(err.error).toBe('e');
  });

  it('mapErr transforms only Err', () => {
    expect(Result.err<number, string>('e').mapErr((e) => e.toUpperCase()).error).toBe('E');
    expect(Result.ok<number, string>(1).mapErr((e) => e.toUpperCase()).value).toBe(1);
  });

  it('unwrapOr returns fallback on Err', () => {
    expect(Result.err<number, string>('e').unwrapOr(7)).toBe(7);
    expect(Result.ok(3).unwrapOr(7)).toBe(3);
  });

  it('supports void Ok', () => {
    const r = Result.ok();
    expect(r.isOk()).toBe(true);
    expect(r.value).toBeUndefined();
  });
});
