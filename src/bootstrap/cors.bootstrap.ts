import { ConfigService } from '@nestjs/config';
import { type NestExpressApplication } from '@nestjs/platform-express';

import { type Env } from '@/shared/config';
import { resolveAllowedOrigins } from '@/shared/http';

/**
 * CORS. Voxlivre est mobile-only (pas de navigateur en prod hors Swagger),
 * mais on garde une politique stricte : seules les origines listées dans
 * `CORS_ALLOWED_ORIGINS` passent ; hors production, fallback localhost.
 *
 * `idempotency-key` est déclaré pour les mutations coûteuses (lancement de
 * conversion, paiement) — sans ça le preflight navigateur échoue.
 */
export function configureCors(app: NestExpressApplication): void {
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  const isProduction = config.get('NODE_ENV', { infer: true }) === 'production';
  const configured = config.get('CORS_ALLOWED_ORIGINS', { infer: true });
  const origins = resolveAllowedOrigins({ isProduction, configured });

  app.enableCors({
    origin: [...origins],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['content-type', 'authorization', 'idempotency-key', 'x-request-id'],
    exposedHeaders: ['x-request-id'],
  });
}
