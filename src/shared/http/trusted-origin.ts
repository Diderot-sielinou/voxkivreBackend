import { DEV_CORS_FALLBACK_ORIGINS } from '@/shared/constants';

/**
 * Liste effective des origines autorisées (CORS). Hors `production`, on
 * ajoute le fallback dev pour ne pas dépendre de `CORS_ALLOWED_ORIGINS` en
 * local.
 */
export function resolveAllowedOrigins(params: {
  isProduction: boolean;
  configured: readonly string[] | undefined;
}): readonly string[] {
  const configured = params.configured ?? [];
  if (params.isProduction) return configured;
  return [...new Set([...DEV_CORS_FALLBACK_ORIGINS, ...configured])];
}
