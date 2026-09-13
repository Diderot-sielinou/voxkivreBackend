import { type INestApplication } from '@nestjs/common';
import { type NestExpressApplication } from '@nestjs/platform-express';
import { type TestingModule } from '@nestjs/testing';

import {
  configureApi,
  configureAuth,
  configureBodyParser,
  configureExpress,
  configureRequestContext,
} from '@/bootstrap';

/**
 * Crée une INestApplication depuis un TestingModule en appliquant la MÊME
 * config HTTP que `main.ts` — via les vraies fonctions de bootstrap, pas une
 * copie : si `configureApi` change (nouveau pipe, nouveau filter), les e2e
 * suivent automatiquement.
 *
 * Volontairement absents : Helmet/CORS/Swagger (headers, pas de logique
 * testable ici) et le logger Pino (bruit dans la sortie Jest).
 */
export async function bootstrapTestApp(moduleFixture: TestingModule): Promise<INestApplication> {
  const app = moduleFixture.createNestApplication<NestExpressApplication>({ bufferLogs: true });

  configureExpress(app);
  configureRequestContext(app);
  configureAuth(app);
  configureBodyParser(app);
  configureApi(app);

  await app.init();
  return app;
}
