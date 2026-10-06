import { DomainError } from '@/shared/kernel';

/** Codes du stockage objet — préfixe `INFRASTRUCTURE_` → 503 (RNF-11). */
export const STORAGE_ERROR_CODES = {
  STORAGE_UNAVAILABLE: 'INFRASTRUCTURE_STORAGE_UNAVAILABLE',
  STORAGE_NOT_CONFIGURED: 'INFRASTRUCTURE_STORAGE_NOT_CONFIGURED',
} as const;

/** Le fournisseur de stockage a échoué (réseau, 5xx, credentials refusés). */
export class StorageUnavailableError extends DomainError {
  readonly code = STORAGE_ERROR_CODES.STORAGE_UNAVAILABLE;
}

/** Aucun stockage configuré (dev sans `S3_*`) : la route n'est pas servable. */
export class StorageNotConfiguredError extends DomainError {
  readonly code = STORAGE_ERROR_CODES.STORAGE_NOT_CONFIGURED;
}
