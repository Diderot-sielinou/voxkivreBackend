import { ConfigService } from '@nestjs/config';
import { type NestExpressApplication } from '@nestjs/platform-express';

import { type Env } from '@/shared/config';

/**
 * Réglages runtime Express.
 *
 * `trust proxy` — sans ça, `req.ip` reflète l'IP du proxy Railway et le
 * rate-limit s'applique en bloc à tous les utilisateurs. 0 en local, 1
 * derrière le proxy Railway.
 */
export function configureExpress(app: NestExpressApplication): void {
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  app.set('trust proxy', config.get('TRUST_PROXY_HOPS', { infer: true }));
}
