import { type NestExpressApplication } from '@nestjs/platform-express';
import { toNodeHandler } from 'better-auth/node';

import { AUTH_BASE_PATH, BETTER_AUTH } from '@/modules/identity/infrastructure/auth/auth.constants';
import { type BetterAuthInstance } from '@/modules/identity/infrastructure/auth/better-auth.config';

/**
 * Monte le handler better-auth en middleware Express sur `/api/auth/*`
 * (envoi/vérification OTP, session, sign-out).
 *
 * DOIT être monté AVANT `configureBodyParser` / `configureApi` : better-auth
 * lit le corps brut lui-même ; un body déjà parsé le casse. Et APRÈS
 * `configureCors` (les middlewares Express s'exécutent dans l'ordre).
 *
 * Mount path SANS wildcard : `app.use('/api/auth', …)` matche déjà tous les
 * sous-chemins, et un `{*any}` ferait perdre la query string à better-call.
 */
export function configureAuth(app: NestExpressApplication): void {
  const auth = app.get<BetterAuthInstance>(BETTER_AUTH);
  app.use(AUTH_BASE_PATH, toNodeHandler(auth));
}
