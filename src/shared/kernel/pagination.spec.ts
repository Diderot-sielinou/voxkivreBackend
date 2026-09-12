import { ERROR_CODES } from './error-codes';
import { buildPage, createCursorCodec } from './pagination';

const SECRET = 's'.repeat(32);

describe('createCursorCodec', () => {
  const codec = createCursorCodec<string>(SECRET);

  it('round-trips sort + id', () => {
    const token = codec.encode('2026-09-12T00:00:00.000Z', 'doc-1');
    const decoded = codec.decode(token);
    expect(decoded.value).toEqual({ sort: '2026-09-12T00:00:00.000Z', id: 'doc-1' });
  });

  it('rejects a tampered payload', () => {
    const token = codec.encode('a', 'id');
    const [payload, sig] = token.split('.');
    const tampered = `${payload.slice(0, -1)}x.${sig}`;
    const r = codec.decode(tampered);
    expect(r.isErr()).toBe(true);
    expect(r.error.code).toBe(ERROR_CODES.INVALID_CURSOR);
  });

  it('rejects a token signed with another secret', () => {
    const other = createCursorCodec<string>('t'.repeat(32));
    expect(codec.decode(other.encode('a', 'id')).isErr()).toBe(true);
  });

  it.each(['', 'nodot', '.', 'abc.'])('rejects malformed token %p', (t) => {
    expect(codec.decode(t).isErr()).toBe(true);
  });

  it('refuses a weak secret', () => {
    expect(() => createCursorCodec('short')).toThrow(/32 chars/);
  });
});

describe('buildPage', () => {
  const encode = (sort: number, id: string) => `${String(sort)}:${id}`;
  const keyOf = (r: { n: number; id: string }) => ({ sort: r.n, id: r.id });

  it('returns no cursor when rows fit in the limit', () => {
    const page = buildPage([{ n: 1, id: 'a' }], 2, keyOf, encode);
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBeNull();
  });

  it('slices to limit and builds the cursor from the last kept row', () => {
    const rows = [
      { n: 1, id: 'a' },
      { n: 2, id: 'b' },
      { n: 3, id: 'c' },
    ];
    const page = buildPage(rows, 2, keyOf, encode);
    expect(page.items.map((r) => r.id)).toEqual(['a', 'b']);
    expect(page.nextCursor).toBe('2:b');
  });

  it('returns empty page for non-positive limit', () => {
    expect(buildPage([{ n: 1, id: 'a' }], 0, keyOf, encode)).toEqual({
      items: [],
      nextCursor: null,
    });
  });
});
