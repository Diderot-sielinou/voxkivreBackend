import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { validateEnv } from './env.schema';

/**
 * Module config global. Validation Zod au boot — l'app ne démarre pas si
 * une variable obligatoire manque ou si une variable a un type incorrect.
 *
 * Tous les modules peuvent injecter `ConfigService<Env, true>` sans
 * import explicite — `isGlobal: true`.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
      // `.env` lu en dev uniquement (NODE_ENV absent ou `development` —
      // absent au lancement de `node dist/main`, il vient du .env lui-même,
      // d'où une liste d'exclusions et non une égalité). En prod (Railway),
      // l'env est injecté par la plateforme. En test, JAMAIS : les e2e
      // doivent être hermétiques —
      // sinon `REDIS_HOST` du .env local branche le rate-limiter sur le vrai
      // Redis du docker-compose (compteurs partagés entre runs, résultats
      // non déterministes). `test/e2e/setup-env.ts` fournit le minimum.
      envFilePath: ['.env'],
      ignoreEnvFile: process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'test',
      // `get()` lit SEULEMENT la sortie de Zod. Sinon, une valeur que le
      // schéma rend `undefined` (variable vide `X=`, cf. `optionalSecret`)
      // retombe sur `process.env` et revient en `""` : constaté avec
      // `ORANGE_SMS_CLIENT_ID=` (adapter construit sans identifiants, pas
      // d'alerte au boot — ADR-0017).
      skipProcessEnv: true,
    }),
  ],
})
export class AppConfigModule {}
