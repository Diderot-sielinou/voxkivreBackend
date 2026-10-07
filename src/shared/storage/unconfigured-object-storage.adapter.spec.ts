import { STORAGE_ERROR_CODES } from './storage.errors';
import { UnconfiguredObjectStorage } from './unconfigured-object-storage.adapter';

describe('UnconfiguredObjectStorage', () => {
  const storage = new UnconfiguredObjectStorage();
  const expected = { code: STORAGE_ERROR_CODES.STORAGE_NOT_CONFIGURED };

  it('fails every operation with INFRASTRUCTURE_STORAGE_NOT_CONFIGURED (→ 503)', async () => {
    await expect(
      storage.presignPut({ key: 'k', contentType: 'x', contentLength: 1, expiresInSeconds: 1 }),
    ).rejects.toMatchObject(expected);
    await expect(storage.presignGet('k', 60)).rejects.toMatchObject(expected);
    await expect(storage.head('k')).rejects.toMatchObject(expected);
    await expect(storage.get('k')).rejects.toMatchObject(expected);
    await expect(storage.readRange('k', 0, 1)).rejects.toMatchObject(expected);
    await expect(storage.put('k', new Uint8Array(1), 'audio/mpeg')).rejects.toMatchObject(expected);
    await expect(storage.delete('k')).rejects.toMatchObject(expected);
  });
});
