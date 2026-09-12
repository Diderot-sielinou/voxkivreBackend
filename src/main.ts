import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { type NestExpressApplication } from '@nestjs/platform-express';
import { Logger as PinoLogger } from 'nestjs-pino';

import { type Env } from '@/shared/config';

import { AppModule } from './app.module';
import {
  configureApi,
  configureBodyParser,
  configureCors,
  configureExpress,
  configureRequestContext,
  configureSecurity,
  configureSwagger,
} from './bootstrap';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Les logs émis avant que Pino soit prêt sont tamponnés puis rejoués.
    bufferLogs: true,
    // Expose `request.rawBody` : requis pour vérifier la signature HMAC
    // des webhooks Mobile Money sur le corps brut, avant que le parser JSON
    // ne le mute.
    rawBody: true,
  });

  // Pino remplace le Logger Nest — tout passe par le format structuré.
  app.useLogger(app.get(PinoLogger));

  // Sans ce hook, `OnApplicationShutdown` (pool Postgres, Redis, workers
  // BullMQ) ne se déclenche pas sur SIGTERM (deploy Railway).
  app.enableShutdownHooks();

  // L'ordre est sensible : Express exécute les middlewares dans l'ordre
  // d'enregistrement (request-context en premier pour que tout le monde ait
  // un request-id ; CORS avant les handlers montés en middleware brut).
  configureExpress(app);
  configureSecurity(app);
  configureRequestContext(app);
  configureCors(app);
  configureBodyParser(app);
  configureApi(app);
  configureSwagger(app);

  const config = app.get<ConfigService<Env, true>>(ConfigService);
  await app.listen(config.get('PORT', { infer: true }), config.get('HOST', { infer: true }));
}
void bootstrap();
