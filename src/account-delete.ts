import { drizzle } from 'drizzle-orm/postgres-js';
import { pino } from 'pino';

import { createMigrationClient } from './migrate';
import { composeAccountDeletion } from './modules/identity/infrastructure/account/account-deletion.composition';
import {
  EXIT,
  parseAccountDeleteArgs,
  runAccountDelete,
  USAGE,
} from './modules/identity/interface/cli/account-delete.command';
import { SystemClock } from './shared/clock/system-clock';
import { validateEnv } from './shared/config/env.schema';

/**
 * Script ops (ADR-0023) : `node dist/account-delete <email | +237…> [--yes]`
 * dans le conteneur de l'API (runbook : infra/README.md). Postgres seul :
 * ni Redis, ni workers, ni crons ; les fichiers partent par l'outbox, que
 * l'API balaie chaque minute.
 */
async function main(): Promise<number> {
  const logger = pino({ name: 'account-delete' });
  const args = parseAccountDeleteArgs(process.argv.slice(2));
  if (args === null) {
    logger.error(USAGE);
    return EXIT.USAGE;
  }

  // Même client que les migrations : une connexion, mêmes règles d'env.
  const sql = createMigrationClient(validateEnv(process.env));
  try {
    const deps = composeAccountDeletion(drizzle(sql), new SystemClock());
    return await runAccountDelete(args, {
      ...deps,
      print: (line) => {
        logger.info(line);
      },
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** Le code de sortie remonte à SSM ; pas de `process.exit` (logs vidés avant). */
async function run(): Promise<void> {
  try {
    process.exitCode = await main();
  } catch (error: unknown) {
    pino({ name: 'account-delete' }).error({ err: error }, 'account deletion failed');
    process.exitCode = EXIT.FAILED;
  }
}

if (require.main === module) void run();
