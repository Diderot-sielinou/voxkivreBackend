import { startS3Storage, type StartedS3 } from '../../../test/support';

import { buildS3Client, S3ObjectStorageAdapter } from './s3-object-storage.adapter';
import { STORAGE_ERROR_CODES } from './storage.errors';

const KEY = 'documents/user-1/doc-1/source.pdf';
const PDF = Buffer.from('%PDF-1.7 integration body');

/**
 * Contre un vrai serveur S3 (RustFS) : prouve le contrat sur lequel repose
 * tout le flux d'import — taille et type **imposés par la signature**, 404
 * traduit en `null`, lecture par plage, suppression idempotente, panne
 * traduite en 503.
 */
describe('S3ObjectStorageAdapter (integration, Testcontainers)', () => {
  let s3: StartedS3;
  let storage: S3ObjectStorageAdapter;

  beforeAll(async () => {
    s3 = await startS3Storage();
    storage = new S3ObjectStorageAdapter(s3.client, s3.options.bucket);
  }, 120_000);

  afterAll(async () => {
    await s3.stop();
  });

  async function presign() {
    return storage.presignPut({
      key: KEY,
      contentType: 'application/pdf',
      contentLength: PDF.length,
      expiresInSeconds: 60,
    });
  }

  it('signs content-length and content-type: any other size or type is refused by the server', async () => {
    const upload = await presign();
    const bigger = await fetch(upload.url, {
      method: 'PUT',
      headers: { 'content-type': 'application/pdf' },
      body: Buffer.concat([PDF, Buffer.from(' + extra')]),
    });
    const otherType = await fetch(upload.url, {
      method: 'PUT',
      headers: { 'content-type': 'text/plain' },
      body: PDF,
    });
    expect(bigger.status).toBe(403);
    expect(otherType.status).toBe(403);
    expect(await storage.head(KEY)).toBeNull();
  });

  it('accepts the exact upload, then head / readRange / delete behave as the port promises', async () => {
    const upload = await presign();
    const put = await fetch(upload.url, { method: 'PUT', headers: upload.headers, body: PDF });
    expect(put.status).toBe(200);

    expect(await storage.head(KEY)).toEqual({
      sizeBytes: PDF.length,
      contentType: 'application/pdf',
    });
    expect(Buffer.from(await storage.readRange(KEY, 0, 4)).toString()).toBe('%PDF-');
    expect(Buffer.from((await storage.get(KEY)) ?? []).equals(PDF)).toBe(true);
    expect(await storage.get('documents/missing.pdf')).toBeNull();

    await storage.delete(KEY);
    expect(await storage.head(KEY)).toBeNull();
    await expect(storage.delete(KEY)).resolves.toBeUndefined(); // idempotent
  });

  it('writes a server-produced object, and overwrites it on a second put (deterministic keys)', async () => {
    const key = 'tts-cache/abc.mp3';
    await storage.put(key, new Uint8Array([1, 2, 3]), 'audio/mpeg');
    await storage.put(key, new Uint8Array([4, 5]), 'audio/mpeg');
    expect(await storage.head(key)).toEqual({ sizeBytes: 2, contentType: 'audio/mpeg' });
    expect([...((await storage.get(key)) ?? [])]).toEqual([4, 5]);
  });

  it('signs a download URL that serves the object directly, with range requests', async () => {
    const key = 'conversions/user-1/conv-1/part-001.mp3';
    await storage.put(key, new Uint8Array([1, 2, 3, 4, 5]), 'audio/mpeg');
    const url = await storage.presignGet(key, 60);
    const full = await fetch(url);
    expect(full.status).toBe(200);
    expect([...new Uint8Array(await full.arrayBuffer())]).toEqual([1, 2, 3, 4, 5]);
    // Reprise d'un téléchargement interrompu (réseau instable) : requête par plage.
    const resumed = await fetch(url, { headers: { range: 'bytes=3-' } });
    expect(resumed.status).toBe(206);
    expect([...new Uint8Array(await resumed.arrayBuffer())]).toEqual([4, 5]);
    const tampered = await fetch(url.replace('part-001', 'part-002'));
    expect(tampered.status).toBe(403);
  });

  it('wraps provider failures (bad credentials) into INFRASTRUCTURE_STORAGE_UNAVAILABLE', async () => {
    const client = buildS3Client({
      ...s3.options,
      secretAccessKey: `${s3.options.secretAccessKey ?? ''}x`,
    });
    const broken = new S3ObjectStorageAdapter(client, s3.options.bucket);
    await expect(broken.head(KEY)).rejects.toMatchObject({
      code: STORAGE_ERROR_CODES.STORAGE_UNAVAILABLE,
    });
    client.destroy();
  });

  it('fails fast with a 503 error when the server is unreachable', async () => {
    const client = buildS3Client({ ...s3.options, endpoint: 'http://127.0.0.1:1' });
    const unreachable = new S3ObjectStorageAdapter(client, s3.options.bucket);
    const started = Date.now();
    await expect(unreachable.head(KEY)).rejects.toMatchObject({
      code: STORAGE_ERROR_CODES.STORAGE_UNAVAILABLE,
    });
    expect(Date.now() - started).toBeLessThan(15_000);
    client.destroy();
  });
});
