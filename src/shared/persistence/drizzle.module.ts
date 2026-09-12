import {
  Global,
  Inject,
  Logger,
  Module,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Options, type Sql } from 'postgres';

import { type Env } from '@/shared/config';
import { instrumentPostgresClient } from '@/shared/observability';

import { DrizzleUnitOfWork } from './drizzle-unit-of-work';
import { DRIZZLE_CLIENT } from './drizzle.constants';
import { UNIT_OF_WORK } from './unit-of-work.port';

export type DrizzleClient = PostgresJsDatabase;

const POSTGRES_SQL_CLIENT = Symbol('PostgresSqlClient');

/**
 * Construit le client postgres-js depuis l'env : `DATABASE_URL` (Railway)
 * si présent, sinon les composants `DB_*`. Le schéma Zod garantit qu'au
 * moins une des deux formes existe.
 */
function createPostgresClient(config: ConfigService<Env, true>): Sql {
  const shared: Options<Record<string, never>> = {
    max: config.get('DB_POOL_MAX', { infer: true }),
    // `require` chiffre sans vérifier le cert serveur (réseau interne
    // Railway). À passer en verify-full si un jour la DB est exposée.
    ssl: config.get('DB_SSL', { infer: true }) ? 'require' : false,
  };

  const url = config.get('DATABASE_URL', { infer: true });
  if (url !== undefined) {
    return postgres(url, shared);
  }

  // Composants séparés : évite d'encoder un mot de passe à caractères
  // spéciaux dans une URL.
  return postgres({
    ...shared,
    host: config.get('DB_HOST', { infer: true }),
    port: config.get('DB_PORT', { infer: true }),
    database: config.get('DB_NAME', { infer: true }),
    username: config.get('DB_USER', { infer: true }),
    password: config.get('DB_PASSWORD', { infer: true }),
  });
}

/**
 * Module global qui expose une instance Drizzle (`DRIZZLE_CLIENT`) via le
 * driver `postgres` (postgres-js).
 *
 * Lifecycle :
 * - Connexion **lazy** : le pool est créé au boot, mais postgres-js ne
 *   contacte le serveur qu'à la première query. Les e2e qui overrident les
 *   repositories bootent donc sans DB.
 * - `OnApplicationShutdown` ferme proprement le pool (drain Railway).
 */
@Global()
@Module({
  providers: [
    {
      provide: POSTGRES_SQL_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): Sql => {
        const slowLogger = new Logger('PostgresSlowQuery');
        return instrumentPostgresClient(
          createPostgresClient(config),
          {
            warnMs: config.get('SLOW_QUERY_WARN_MS', { infer: true }),
            errorMs: config.get('SLOW_QUERY_ERROR_MS', { infer: true }),
          },
          {
            warn: (msg) => {
              slowLogger.warn(msg);
            },
            error: (msg) => {
              slowLogger.error(msg);
            },
          },
        );
      },
    },
    {
      provide: DRIZZLE_CLIENT,
      inject: [POSTGRES_SQL_CLIENT],
      useFactory: (client: Sql): DrizzleClient => drizzle(client),
    },
    { provide: UNIT_OF_WORK, useClass: DrizzleUnitOfWork },
  ],
  exports: [DRIZZLE_CLIENT, UNIT_OF_WORK],
})
export class DrizzleModule implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(DrizzleModule.name);

  constructor(@Inject(POSTGRES_SQL_CLIENT) private readonly sql: Sql) {}

  onModuleInit(): void {
    this.logger.log('Drizzle client initialised (lazy connection)');
  }

  async onApplicationShutdown(): Promise<void> {
    this.logger.log('Closing Postgres pool');
    await this.sql.end({ timeout: 5 });
  }
}
