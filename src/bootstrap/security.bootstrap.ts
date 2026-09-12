import { type NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';

import { HSTS_MAX_AGE_SECONDS } from '@/shared/constants';

/**
 * Headers de sécurité HTTP + parser de cookies.
 *
 * Helmet — HSTS (1 an, preload), X-Frame-Options, X-Content-Type-Options,
 * Referrer-Policy. CSP désactivée : l'API ne sert que du JSON, et Swagger
 * UI a besoin d'inline scripts incompatibles avec la CSP stricte.
 *
 * cookie-parser — better-auth pose un cookie de session ; le client mobile
 * utilisera plutôt le bearer token, mais Swagger UI (navigateur) passe par
 * le cookie.
 */
export function configureSecurity(app: NestExpressApplication): void {
  app.use(
    helmet({
      contentSecurityPolicy: false,
      strictTransportSecurity: {
        maxAge: HSTS_MAX_AGE_SECONDS,
        includeSubDomains: true,
        preload: true,
      },
    }),
  );
  app.use(cookieParser());
}
