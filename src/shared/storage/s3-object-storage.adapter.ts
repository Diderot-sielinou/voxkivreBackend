import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Logger } from '@nestjs/common';

import {
  type ObjectMetadata,
  type ObjectStoragePort,
  type PresignedUpload,
  type PresignPutInput,
} from './object-storage.port';
import { StorageUnavailableError } from './storage.errors';

const HTTP_NOT_FOUND = 404;
const NEUTRAL_MESSAGE = 'Object storage is temporarily unavailable';

/** Paramètres de connexion dérivés de l'env (cf. `storage.module.ts`). */
export interface S3ConnectionOptions {
  readonly endpoint: string;
  readonly region: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly forcePathStyle: boolean;
}

/**
 * Construit le client S3. Réglages imposés par le chemin de requête et par
 * R2 :
 * - timeouts courts + 2 tentatives : une requête HTTP mobile ne doit pas
 *   pendre sur un stockage lent (même logique qu'ADR-0002 pour Redis) ;
 * - checksums `WHEN_REQUIRED` : depuis 2025 le SDK ajoute par défaut un
 *   checksum CRC32 aux PUT, y compris dans les URL pré-signées — le client
 *   mobile devrait alors l'envoyer, et R2 ne gère pas tous les algorithmes.
 */
export function buildS3Client(options: S3ConnectionOptions): S3Client {
  return new S3Client({
    endpoint: options.endpoint,
    region: options.region,
    forcePathStyle: options.forcePathStyle,
    credentials: {
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
    },
    maxAttempts: 2,
    requestHandler: { connectionTimeout: 2000, requestTimeout: 5000 },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}

function isNotFound(error: unknown): boolean {
  return (
    error instanceof S3ServiceException &&
    (error.name === 'NotFound' ||
      error.name === 'NoSuchKey' ||
      error.$metadata.httpStatusCode === HTTP_NOT_FOUND)
  );
}

/**
 * Adapter S3-compatible du `ObjectStoragePort` : Cloudflare R2 en prod,
 * MinIO en local et en tests d'intégration — même code, seule la config
 * change (ADR-0007).
 */
export class S3ObjectStorageAdapter implements ObjectStoragePort {
  private readonly logger = new Logger(S3ObjectStorageAdapter.name);

  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}

  async presignPut(input: PresignPutInput): Promise<PresignedUpload> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: input.key,
      ContentType: input.contentType,
      ContentLength: input.contentLength,
    });
    // `content-length` et `content-type` signés : un upload d'une autre
    // taille ou d'un autre type est rejeté par le fournisseur (403).
    const url = await this.wrap('presignPut', input.key, () =>
      getSignedUrl(this.client, command, {
        expiresIn: input.expiresInSeconds,
        signableHeaders: new Set(['content-type', 'content-length']),
      }),
    );
    return {
      url,
      method: 'PUT',
      headers: {
        'content-type': input.contentType,
        'content-length': String(input.contentLength),
      },
    };
  }

  async head(key: string): Promise<ObjectMetadata | null> {
    try {
      const out = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { sizeBytes: out.ContentLength ?? 0, contentType: out.ContentType ?? null };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw this.unavailable('head', key, error);
    }
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      const out = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return out.Body === undefined ? new Uint8Array() : await out.Body.transformToByteArray();
    } catch (error) {
      if (isNotFound(error)) return null;
      throw this.unavailable('get', key, error);
    }
  }

  async readRange(key: string, start: number, endInclusive: number): Promise<Uint8Array> {
    return this.wrap('readRange', key, async () => {
      const out = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Range: `bytes=${String(start)}-${String(endInclusive)}`,
        }),
      );
      return out.Body === undefined ? new Uint8Array() : out.Body.transformToByteArray();
    });
  }

  async delete(key: string): Promise<void> {
    await this.wrap('delete', key, () =>
      this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key })),
    );
  }

  private async wrap<T>(operation: string, key: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      throw this.unavailable(operation, key, error);
    }
  }

  /** Log complet côté serveur, message neutre côté client (error-handling.md). */
  private unavailable(operation: string, key: string, error: unknown): StorageUnavailableError {
    this.logger.error({ err: error, operation, key }, 'Object storage operation failed');
    return new StorageUnavailableError(NEUTRAL_MESSAGE, { cause: error });
  }
}
