import { Units } from '../value-objects/units.vo';

import { allocate, splitRefund, totalUnits, type UnitsBySource } from './allocation';

const u = (n: number): Units => Units.of(n);
const sources = (free: number, pass: number, credits: number): UnitsBySource => ({
  free: u(free),
  pass: u(pass),
  credits: u(credits),
});

describe('allocate', () => {
  it('takes from the free tier first for a standard voice', () => {
    const r = allocate({ requested: u(30), tier: 'standard', available: sources(50, 100, 100) });
    expect(r.value).toEqual(sources(30, 0, 0));
  });

  it('spills over free → pass → credits, in that order', () => {
    const r = allocate({ requested: u(170), tier: 'standard', available: sources(50, 100, 100) });
    expect(r.value).toEqual(sources(50, 100, 20));
  });

  it('never uses the free tier for a natural voice', () => {
    const r = allocate({ requested: u(120), tier: 'natural', available: sources(50, 100, 100) });
    expect(r.value).toEqual(sources(0, 100, 20));
  });

  it('takes everything when the request matches the usable total exactly', () => {
    const r = allocate({ requested: u(250), tier: 'standard', available: sources(50, 100, 100) });
    expect(r.value).toEqual(sources(50, 100, 100));
  });

  it('reports a shortfall without taking anything', () => {
    const r = allocate({ requested: u(251), tier: 'standard', available: sources(50, 100, 100) });
    expect(r.isErr()).toBe(true);
    expect(r.error).toEqual({
      requested: 251,
      tier: 'standard',
      available: sources(50, 100, 100),
      usable: 250,
    });
  });

  it('counts the free tier as unusable in a natural-voice shortfall', () => {
    const r = allocate({ requested: u(60), tier: 'natural', available: sources(1000, 0, 10) });
    expect(r.error).toMatchObject({ usable: 10, available: sources(1000, 0, 10) });
  });

  it('allocates nothing for a zero request', () => {
    expect(
      allocate({ requested: u(0), tier: 'natural', available: sources(0, 0, 0) }).value,
    ).toEqual(sources(0, 0, 0));
  });
});

describe('splitRefund', () => {
  const reserved = sources(50, 100, 20);

  it('gives back credits first, then the pass, then the free tier', () => {
    expect(splitRefund(reserved, u(10))).toEqual(sources(0, 0, 10));
    expect(splitRefund(reserved, u(70))).toEqual(sources(0, 50, 20));
    expect(splitRefund(reserved, u(160))).toEqual(sources(40, 100, 20));
  });

  it('never refunds more than each source gave', () => {
    expect(splitRefund(reserved, u(1000))).toEqual(reserved);
  });

  it('round-trips: a full refund returns the whole reservation', () => {
    expect(splitRefund(reserved, totalUnits(reserved))).toEqual(reserved);
  });
});
