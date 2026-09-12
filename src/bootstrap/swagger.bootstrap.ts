import { ConfigService } from '@nestjs/config';
import { type NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { type Env } from '@/shared/config';
import {
  API_DEFAULT_VERSION,
  API_NAME,
  API_TITLE,
  SWAGGER_JSON_PATH,
  SWAGGER_PATH,
} from '@/shared/constants';

/**
 * OpenAPI / Swagger. Activé par défaut hors `production` (DX) ; en prod un
 * opt-in explicite `SWAGGER_ENABLED=true` est requis — la spec dévoile la
 * surface d'API. Le JSON (`/docs/openapi.json`) servira aussi à générer le
 * client Dart de l'app Flutter.
 */
export function configureSwagger(app: NestExpressApplication): void {
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  const optIn = config.get('SWAGGER_ENABLED', { infer: true });
  const enabled = optIn ?? config.get('NODE_ENV', { infer: true }) !== 'production';
  if (!enabled) return;

  const builder = new DocumentBuilder()
    .setTitle(API_NAME)
    .setDescription(`${API_TITLE} — OpenAPI v${API_DEFAULT_VERSION}`)
    .setVersion(API_DEFAULT_VERSION)
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, builder);

  SwaggerModule.setup(SWAGGER_PATH, app, document, {
    jsonDocumentUrl: SWAGGER_JSON_PATH,
    swaggerOptions: { persistAuthorization: true },
  });
}
