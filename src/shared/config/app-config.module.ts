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
      // `.env` lu en dev/test. En prod (Railway), l'env est injecté par la
      // plateforme — aucun fichier .env n'existe dans l'image.
      envFilePath: ['.env'],
      ignoreEnvFile: process.env.NODE_ENV === 'production',
    }),
  ],
})
export class AppConfigModule {}
