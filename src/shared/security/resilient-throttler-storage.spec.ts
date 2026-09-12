import { type ThrottlerStorage } from '@nestjs/throttler';
// Non ré-exporté par le barrel de @nestjs/throttler : import par chemin interne.
import { type ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';

import { ResilientThrottlerStorage } from './resilient-throttler-storage';

const RECORD: ThrottlerStorageRecord = {
  totalHits: 3,
  timeToExpire: 1,
  isBlocked: false,
  timeToBlockExpire: 0,
};

describe('ResilientThrottlerStorage', () => {
  it('passes through the inner record when the store works', async () => {
    const inner: ThrottlerStorage = { increment: jest.fn().mockResolvedValue(RECORD) };
    const warn = jest.fn();
    const sut = new ResilientThrottlerStorage(inner, { warn });

    await expect(sut.increment('ip', 1000, 10, 0, 'default')).resolves.toEqual(RECORD);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- lecture d'un jest.fn(), pas un appel
    expect(inner.increment).toHaveBeenCalledWith('ip', 1000, 10, 0, 'default');
    expect(warn).not.toHaveBeenCalled();
  });

  it('fails open with a permissive record and a warning when the store throws', async () => {
    const inner: ThrottlerStorage = {
      increment: jest.fn().mockRejectedValue(new Error('Command timed out')),
    };
    const warn = jest.fn();
    const sut = new ResilientThrottlerStorage(inner, { warn });

    const record = await sut.increment('ip', 2000, 10, 0, 'default');

    expect(record).toEqual({
      totalHits: 0,
      timeToExpire: 2,
      isBlocked: false,
      timeToBlockExpire: 0,
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Command timed out'));
  });
});
