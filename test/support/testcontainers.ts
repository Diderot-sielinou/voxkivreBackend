import { resolve } from 'node:path';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres, { type Sql } from 'postgres';

const DEFAULT_POSTGRES_IMAGE = 'postgres:16-alpine';
const MIGRATIONS_DIR = resolve(__dirname, '../../src/shared/persistence/migrations');

export interface StartedPostgres {
  readonly container: StartedPostgreSqlContainer;
  readonly connectionString: string;
  /** Client postgres-js (à fermer via `stop()`). */
  readonly sql: Sql;
  readonly db: PostgresJsDatabase;
  stop(): Promise<void>;
}

/**
 * Démarre un Postgres jetable, applique TOUTES les migrations du repo et
 * renvoie un client Drizzle. L'appelant DOIT `await stop()` en `afterAll`.
 *
 * Pourquoi appliquer les migrations réelles (et pas `drizzle-kit push`) :
 * c'est exactement ce que fait le déploiement — un `.sql` cassé est vu ici.
 */
export async function startMigratedPostgres(
  image = DEFAULT_POSTGRES_IMAGE,
): Promise<StartedPostgres> {
  const container = await new PostgreSqlContainer(image).start();
  const connectionString = container.getConnectionUri();
  const sql = postgres(connectionString, { max: 2, prepare: false });
  const db = drizzle(sql);
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return {
    container,
    connectionString,
    sql,
    db,
    stop: async () => {
      await sql.end({ timeout: 5 });
      await container.stop();
    },
  };
}
