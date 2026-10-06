import {
  type ObjectMetadata,
  type ObjectStoragePort,
  type PresignedUpload,
  type PresignPutInput,
} from '@/shared/storage/object-storage.port';
import { StorageUnavailableError } from '@/shared/storage/storage.errors';

/**
 * Fake du `ObjectStoragePort` : un dictionnaire clé → octets. `seed` simule
 * l'upload direct du mobile ; `failing` simule une panne fournisseur.
 */
export class FakeObjectStorage implements ObjectStoragePort {
  readonly objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  readonly presigned: PresignPutInput[] = [];
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
