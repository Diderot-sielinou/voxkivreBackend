import { type ConfigService } from '@nestjs/config';

import { type Env } from '@/shared/config';

import {
  ABANDONED_UPLOAD_TTL_SECONDS,
  type DocumentUploadPolicy,
  UPLOAD_URL_TTL_SECONDS,
} from '../../domain/document-upload-policy';

/** Politique d'import : plafond depuis l'env, durées = conventions produit (ADR-0007). */
export function buildDocumentUploadPolicy(config: ConfigService<Env, true>): DocumentUploadPolicy {
  return {
    maxSizeBytes: config.get('DOCUMENT_MAX_SIZE_BYTES', { infer: true }),
    uploadUrlTtlSeconds: UPLOAD_URL_TTL_SECONDS,
    abandonedUploadTtlSeconds: ABANDONED_UPLOAD_TTL_SECONDS,
  };
}
