import {
  type ObjectMetadata,
  type ObjectStoragePort,
  type PresignedUpload,
  type PresignPartInput,
  type PresignPutInput,
  type UploadedPart,
} from '@/shared/storage/object-storage.port';
import { StorageUnavailableError } from '@/shared/storage/storage.errors';

/**
 * Fake du `ObjectStoragePort` : un dictionnaire clé → octets. `seed` simule
 * l'upload direct du mobile ; `failing` simule une panne fournisseur.
 */
export class FakeObjectStorage implements ObjectStoragePort {
  readonly objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  readonly presigned: PresignPutInput[] = [];
  readonly presignedParts: PresignPartInput[] = [];
  /** Envois multipart ouverts : identifiant → clé, type, morceaux reçus. */
  readonly multipart = new Map<
    string,
    { key: string; contentType: string; parts: Map<number, Uint8Array> }
  >();
  readonly aborted: string[] = [];
  failing = false;

  /** Dépose un objet sans passer par le port (simule l'upload direct du mobile). */
  seed(key: string, content: string | Uint8Array, contentType = 'application/pdf'): void {
    const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
    this.objects.set(key, { bytes, contentType });
  }

  presignPut(input: PresignPutInput): Promise<PresignedUpload> {
    this.presigned.push(input);
    return Promise.resolve({
      url: `https://storage.test/${input.key}?signature=fake`,
      method: 'PUT',
      headers: {
        'content-type': input.contentType,
        'content-length': String(input.contentLength),
      },
    });
  }

  /** Simule l'envoi d'un morceau par le mobile. */
  seedPart(uploadId: string, partNumber: number, content: string | Uint8Array): void {
    const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
    this.multipart.get(uploadId)?.parts.set(partNumber, bytes);
  }

  createMultipartUpload(key: string, contentType: string): Promise<string> {
    if (this.failing) return this.fail();
    const uploadId = `upload-${String(this.multipart.size + 1)}`;
    this.multipart.set(uploadId, { key, contentType, parts: new Map() });
    return Promise.resolve(uploadId);
  }

  presignUploadPart(input: PresignPartInput): Promise<PresignedUpload> {
    this.presignedParts.push(input);
    return Promise.resolve({
      url: `https://storage.test/${input.key}?partNumber=${String(input.partNumber)}&signature=fake`,
      method: 'PUT',
      headers: { 'content-length': String(input.contentLength) },
    });
  }

  listUploadedParts(key: string, uploadId: string): Promise<readonly UploadedPart[] | null> {
    if (this.failing) return this.fail();
    const upload = this.multipart.get(uploadId);
    if (upload?.key !== key) return Promise.resolve(null);
    return Promise.resolve(
      [...upload.parts.entries()].map(([partNumber, bytes]) => ({
        partNumber,
        sizeBytes: bytes.length,
        etag: `etag-${String(partNumber)}`,
      })),
    );
  }

  completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: readonly UploadedPart[],
  ): Promise<void> {
    if (this.failing) return this.fail();
    const upload = this.multipart.get(uploadId);
    if (upload === undefined) return Promise.reject(new Error('NoSuchUpload'));
    const chunks = parts
      .toSorted((a, b) => a.partNumber - b.partNumber)
      .map((part) => upload.parts.get(part.partNumber) ?? new Uint8Array());
    const bytes = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    this.seed(key, bytes, upload.contentType);
    this.multipart.delete(uploadId);
    return Promise.resolve();
  }

  abortMultipartUpload(_key: string, uploadId: string): Promise<void> {
    if (this.failing) return this.fail();
    this.aborted.push(uploadId);
    this.multipart.delete(uploadId);
    return Promise.resolve();
  }

  presignGet(key: string, expiresInSeconds: number): Promise<string> {
    return Promise.resolve(
      `https://storage.test/${key}?expires=${String(expiresInSeconds)}&signature=fake`,
    );
  }

  head(key: string): Promise<ObjectMetadata | null> {
    if (this.failing) return this.fail();
    const found = this.objects.get(key);
    return Promise.resolve(
      found === undefined
        ? null
        : { sizeBytes: found.bytes.length, contentType: found.contentType },
    );
  }

  get(key: string): Promise<Uint8Array | null> {
    if (this.failing) return this.fail();
    return Promise.resolve(this.objects.get(key)?.bytes ?? null);
  }

  readRange(key: string, start: number, endInclusive: number): Promise<Uint8Array> {
    if (this.failing) return this.fail();
    const found = this.objects.get(key);
    return Promise.resolve(found?.bytes.slice(start, endInclusive + 1) ?? new Uint8Array());
  }

  put(key: string, body: Uint8Array, contentType: string): Promise<void> {
    if (this.failing) return this.fail();
    this.seed(key, body, contentType);
    return Promise.resolve();
  }

  delete(key: string): Promise<void> {
    if (this.failing) return this.fail();
    this.objects.delete(key);
    return Promise.resolve();
  }

  private fail(): Promise<never> {
    return Promise.reject(new StorageUnavailableError('fake storage down'));
  }
}
