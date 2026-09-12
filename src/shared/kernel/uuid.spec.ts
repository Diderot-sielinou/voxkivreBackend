import { UUID_NAMESPACES, isUuid, uuidV5, uuidV7 } from './uuid';

describe('uuidV7', () => {
  it('produces well-formed v7 UUIDs', () => {
    const id = uuidV7();
    expect(isUuid(id)).toBe(true);
    expect(id[14]).toBe('7');
    expect(['8', '9', 'a', 'b']).toContain(id[19]);
  });

  it('is time-ordered (lexicographic order follows creation order)', () => {
    const a = uuidV7();
    const b = uuidV7();
    expect(a.slice(0, 12) <= b.slice(0, 12)).toBe(true);
  });

  it('is unique across many calls', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => uuidV7()));
    expect(ids.size).toBe(1000);
  });
});

describe('uuidV5', () => {
  it('is deterministic for the same (name, namespace)', () => {
    const a = uuidV5('fr-FR-standard-A', UUID_NAMESPACES.OID);
    const b = uuidV5('fr-FR-standard-A', UUID_NAMESPACES.OID);
    expect(a).toBe(b);
    expect(a[14]).toBe('5');
  });

  it('differs when name differs', () => {
    expect(uuidV5('a', UUID_NAMESPACES.OID)).not.toBe(uuidV5('b', UUID_NAMESPACES.OID));
  });

  it('rejects an invalid namespace', () => {
    expect(() => uuidV5('x', 'not-a-uuid')).toThrow(TypeError);
  });
});

describe('isUuid', () => {
  it.each(['', 'abc', '6ba7b810-9dad-11d1-80b4-00c04fd430c'])('rejects %p', (v) => {
    expect(isUuid(v)).toBe(false);
  });

  it('accepts a canonical UUID', () => {
    expect(isUuid(UUID_NAMESPACES.DNS)).toBe(true);
  });
});
