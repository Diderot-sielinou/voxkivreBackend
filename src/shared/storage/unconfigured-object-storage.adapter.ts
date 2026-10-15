import {
  type ObjectStoragePort,
  type PresignPartInput,
  type PresignPutInput,
  type UploadedPart,
} from './object-storage.port';
import { StorageNotConfiguredError } from './storage.errors';

const MESSAGE = 'Object storage is not configured (S3_* variables missing).';

/**
 * Adapter de repli quand `S3_*` est absent (dev, e2e) : l'app boote quand
 * même (connexions lazy, AGENTS.md) et seules les routes qui touchent au
 * stockage répondent 503 `INFRASTRUCTURE_STORAGE_NOT_CONFIGURED`. En
 * production, `PRODUCTION_RULES` empêche d'arriver ici.
 */
export class UnconfiguredObjectStorage implements ObjectStoragePort {
  presignPut(_input: PresignPutInput): Promise<never> {
    return Promise.reject(new StorageNotConfiguredError(MESSAGE));
  }

  presignGet(_key: string, _expiresInSeconds: number): Promise<never> {
    return Promise.reject(new StorageNotConfiguredError(MESSAGE));
  }

  createMultipartUpload(_key: string, _contentType: string): Promise<never> {
    return Promise.reject(new StorageNotConfiguredError(MESSAGE));
  }

  presignUploadPart(_input: PresignPartInput): Promise<never> {
    return Promise.reject(new StorageNotConfiguredError(MESSAGE));
  }

  listUploadedParts(_key: string, _uploadId: string): Promise<never> {
    return Promise.reject(new StorageNotConfiguredError(MESSAGE));
  }

  completeMultipartUpload(
    _key: string,
    _uploadId: string,
    _parts: readonly UploadedPart[],
  ): Promise<never> {
    return Promise.reject(new StorageNotConfiguredError(MESSAGE));
  }

  abortMultipartUpload(_key: string, _uploadId: string): Promise<never> {
    return Promise.reject(new StorageNotConfiguredError(MESSAGE));
  }

  head(_key: string): Promise<never> {
    return Promise.reject(new StorageNotConfiguredError(MESSAGE));
  }

  get(_key: string): Promise<never> {
    return Promise.reject(new StorageNotConfiguredError(MESSAGE));
  }

  readRange(_key: string, _start: number, _endInclusive: number): Promise<never> {
    return Promise.reject(new StorageNotConfiguredError(MESSAGE));
  }

  put(_key: string, _body: Uint8Array, _contentType: string): Promise<never> {
    return Promise.reject(new StorageNotConfiguredError(MESSAGE));
  }

  delete(_key: string): Promise<never> {
    return Promise.reject(new StorageNotConfiguredError(MESSAGE));
  }
}
