import { ConfigService } from '@nestjs/config';
import { type NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger as PinoLogger } from 'nestjs-pino';

import { AUTH_BASE_PATH, BETTER_AUTH } from '@/modules/identity/infrastructure/auth/auth.constants';
import { type BetterAuthInstance } from '@/modules/identity/infrastructure/auth/better-auth.config';
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
export async function configureSwagger(app: NestExpressApplication): Promise<void> {
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
  await mergeBetterAuthSchema(
    document,
    app.get<BetterAuthInstance>(BETTER_AUTH),
    app.get(PinoLogger),
  );

  SwaggerModule.setup(SWAGGER_PATH, app, document, {
    jsonDocumentUrl: SWAGGER_JSON_PATH,
    swaggerOptions: { persistAuthorization: true },
  });
}

/**
 * Merge le schéma OpenAPI du plugin `openAPI()` de better-auth dans le
 * document Swagger Nest : les routes `/api/auth/*` sont un middleware
 * Express, invisibles pour l'introspection Nest. Fail-soft : en cas d'échec
 * on garde la doc Nest seule plutôt que de bloquer le boot.
 */
async function mergeBetterAuthSchema(
  document: ReturnType<typeof SwaggerModule.createDocument>,
  auth: BetterAuthInstance,
  log: PinoLogger,
): Promise<void> {
  try {
    const schema = (await auth.api.generateOpenAPISchema()) as {
      paths?: Record<string, unknown>;
      components?: { schemas?: Record<string, unknown> };
    };
    for (const [path, def] of Object.entries(schema.paths ?? {})) {
      const absolutePath = path.startsWith(AUTH_BASE_PATH) ? path : `${AUTH_BASE_PATH}${path}`;
      document.paths[absolutePath] = def as never;
    }
    if (schema.components?.schemas !== undefined) {
      document.components = document.components ?? {};
      document.components.schemas = {
        ...document.components.schemas,
        ...schema.components.schemas,
      } as never;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn(`better-auth OpenAPI merge skipped: ${message}`);
  }
}
