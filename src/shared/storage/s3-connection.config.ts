import { type ConfigService } from '@nestjs/config';

import { type Env } from '@/shared/config';

import { type S3ConnectionOptions } from './s3-object-storage.adapter';

/**
 * Connexion S3 depuis l'env (ADR-0007, ADR-0012), ou `null` sans bucket :
 * - **S3 natif d'AWS** : `S3_BUCKET` seul → région `AWS_REGION`, aucune clé
 *   (rôle d'instance via la chaîne par défaut du SDK) ;
 * - **autre fournisseur** (RustFS en local, R2) : `S3_ENDPOINT` + clés.
 * Le schéma Zod garantit la cohérence (clés par paire, région présente).
 */
export function s3ConnectionFromEnv(config: ConfigService<Env, true>): S3ConnectionOptions | null {
  const bucket = config.get('S3_BUCKET', { infer: true });
  if (bucket === undefined) return null;
  const endpoint = config.get('S3_ENDPOINT', { infer: true });
  const accessKeyId = config.get('S3_ACCESS_KEY_ID', { infer: true });
  const secretAccessKey = config.get('S3_SECRET_ACCESS_KEY', { infer: true });
  if (endpoint === undefined) {
    return {
      bucket,
      region: config.get('AWS_REGION', { infer: true }),
      forcePathStyle: false,
      ...(accessKeyId === undefined || secretAccessKey === undefined
        ? {}
        : { accessKeyId, secretAccessKey }),
    };
  }
  return {
    endpoint,
    bucket,
    region: config.get('S3_REGION', { infer: true }),
    forcePathStyle: config.get('S3_FORCE_PATH_STYLE', { infer: true }),
    ...(accessKeyId === undefined || secretAccessKey === undefined
      ? {}
      : { accessKeyId, secretAccessKey }),
  };
}
