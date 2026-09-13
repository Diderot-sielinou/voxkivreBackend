import { resolve } from 'node:path';

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { pino } from 'pino';
import postgres, { type Sql } from 'postgres';

import { validateEnv, type Env } from './shared/config/env.schema';

// En conteneur, l'image copie les .sql dans `/app/migrations` (cf.
// Dockerfile) ; `process.cwd()` vaut `/app`. Override via `MIGRATIONS_DIR`
// pour le run local (`src/shared/persistence/migrations`).
const DEFAULT_MIGRATIONS_DIR = resolve(process.cwd(), 'migrations');

/** Même règle que DrizzleModule : `DATABASE_URL` prime, sinon composants. */
export function createMigrationClient(env: Env): Sql {
  // `max: 1` : les migrations sont sérialisées. `prepare: false` : DDL
  // multi-statements, certains drivers refusent de le préparer.
  const shared = { max: 1, prepare: false, ssl: env.DB_SSL ? ('require' as const) : false };
  if (env.DATABASE_URL !== undefined) return postgres(env.DATABASE_URL, shared);
  return postgres({
    ...shared,
    host: env.DB_HOST,
    port: env.DB_PORT,
    database: env.DB_NAME,
    username: env.DB_USER,
    password: env.DB_PASSWORD,
  });
}

async function runMigrations(): Promise<void> {
  const env = validateEnv(process.env);
  const migrationsFolder = process.env.MIGRATIONS_DIR ?? DEFAULT_MIGRATIONS_DIR;
  const logger = pino({ name: 'migrate', level: env.LOG_LEVEL ?? 'info' });

  const sql = createMigrationClient(env);
  try {
    logger.info({ migrationsFolder }, 'applying migrations');
    await migrate(drizzle(sql), { migrationsFolder });
    logger.info('migrations applied');
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (require.main === module) {
  runMigrations().catch((error: unknown) => {
    pino({ name: 'migrate' }).error({ err: error }, 'migration failed');
    // Script CLI (`node dist/migrate`) : l'exit code gate le déploiement.
    // eslint-disable-next-line unicorn/no-process-exit
    process.exit(1);
  });
}
