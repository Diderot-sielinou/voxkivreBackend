import { ValidationPipe, VersioningType } from '@nestjs/common';
import { type NestExpressApplication } from '@nestjs/platform-express';

import { API_DEFAULT_VERSION } from '@/shared/constants';
import { ProblemDetailsFilter } from '@/shared/http';

/**
 * Surface API publique :
 * - URI versioning (`/v1/...`, ADR-0002). Les endpoints sans
 *   `@Controller({ version })` tombent en v1 ; les meta (`/health`) sont
 *   `VERSION_NEUTRAL`. Un client mobile déployé sur les stores ne peut pas
 *   être mis à jour de force : le versioning est vital.
 * - ValidationPipe global : `whitelist` + `forbidNonWhitelisted` (un champ
 *   inconnu = 400, pas ignoré silencieusement), `transform` pour les DTOs.
 * - Filter global Problem Details (RFC 7807).
 */
export function configureApi(app: NestExpressApplication): void {
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: API_DEFAULT_VERSION,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  app.useGlobalFilters(new ProblemDetailsFilter());
}
