import { Global, Inject, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { type Env } from '@/shared/config';

import { OBJECT_STORAGE, type ObjectStoragePort } from './object-storage.port';
import { buildS3Client, S3ObjectStorageAdapter } from './s3-object-storage.adapter';
import { UnconfiguredObjectStorage } from './unconfigured-object-storage.adapter';

import type { S3Client } from '@aws-sdk/client-s3';

const S3_CLIENT = Symbol('S3Client');

/** `S3Client` si les 4 variables `S3_*` sont présentes, sinon `null`. */
function createS3Client(config: ConfigService<Env, true>): S3Client | null {
  const endpoint = config.get('S3_ENDPOINT', { infer: true });
  const bucket = config.get('S3_BUCKET', { infer: true });
  const accessKeyId = config.get('S3_ACCESS_KEY_ID', { infer: true });
  const secretAccessKey = config.get('S3_SECRET_ACCESS_KEY', { infer: true });
  if (
    endpoint === undefined ||
    bucket === undefined ||
    accessKeyId === undefined ||
    secretAccessKey === undefined
  ) {
    return null;
  }
  return buildS3Client({
    endpoint,
    bucket,
    accessKeyId,
    secretAccessKey,
    region: config.get('S3_REGION', { infer: true }),
    forcePathStyle: config.get('S3_FORCE_PATH_STYLE', { infer: true }),
  });
}

/**
 * Module global du stockage objet (ADR-0007). Même pattern que
 * `DrizzleModule` / `RedisModule` : factory depuis l'env, aucune I/O au boot
 * (le client S3 n'ouvre de socket qu'à la première commande), fermeture en
 * `OnApplicationShutdown`.
 *
 * Sans `S3_*` (dev, e2e), `OBJECT_STORAGE` est un adapter qui répond 503
 * `INFRASTRUCTURE_STORAGE_NOT_CONFIGURED` : l'app boote quand même.
 */
@Global()
@Module({
  providers: [
    {
      provide: S3_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): S3Client | null => createS3Client(config),
    },
    {
      provide: OBJECT_STORAGE,
      inject: [ConfigService, S3_CLIENT],
      useFactory: (
        config: ConfigService<Env, true>,
        client: S3Client | null,
      ): ObjectStoragePort => {
        const bucket = config.get('S3_BUCKET', { infer: true });
        if (client === null || bucket === undefined) {
          new Logger(StorageModule.name).warn(
            'S3_* not configured: object storage routes will answer 503',
          );
          return new UnconfiguredObjectStorage();
        }
        return new S3ObjectStorageAdapter(client, bucket);
      },
    },
  ],
  exports: [OBJECT_STORAGE],
})
export class StorageModule implements OnApplicationShutdown {
  constructor(@Inject(S3_CLIENT) private readonly client: S3Client | null) {}

  onApplicationShutdown(): void {
    // Ferme les sockets keep-alive du handler HTTP du SDK.
    this.client?.destroy();
  }
}
