import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';

import { CreateBucketCommand, type S3Client } from '@aws-sdk/client-s3';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres, { type Sql } from 'postgres';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';

import {
  buildS3Client,
  type S3ConnectionOptions,
} from '../../src/shared/storage/s3-object-storage.adapter';

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

const DEFAULT_S3_IMAGE = 'rustfs/rustfs:1.0.1';
const S3_PORT = 9000;

export interface StartedS3 {
  readonly container: StartedTestContainer;
  readonly options: S3ConnectionOptions;
  readonly client: S3Client;
  stop(): Promise<void>;
}

/**
 * Démarre un stockage S3-compatible jetable (RustFS, même image que le
 * docker-compose) et crée le bucket. L'appelant DOIT `await stop()`.
 *
 * Pourquoi un vrai serveur S3 et pas un mock du SDK : ce qu'on doit prouver
 * (signature de `content-length` dans l'URL pré-signée, 404 sur `head`,
 * lecture par plage) est le comportement du **serveur**, pas du client.
 */
export async function startS3Storage(image = DEFAULT_S3_IMAGE): Promise<StartedS3> {
  // Identifiants jetables tirés à chaque run : aucun secret, même factice,
  // écrit dans le repo (gitleaks scanne tout l'historique).
  const accessKeyId = randomBytes(8).toString('hex');
  const secretAccessKey = randomBytes(16).toString('hex');
  const container = await new GenericContainer(image)
    .withEnvironment({ RUSTFS_ACCESS_KEY: accessKeyId, RUSTFS_SECRET_KEY: secretAccessKey })
    .withExposedPorts(S3_PORT)
    .withWaitStrategy(Wait.forHttp('/health', S3_PORT).forStatusCode(200))
    .start();
  const options: S3ConnectionOptions = {
    endpoint: `http://${container.getHost()}:${String(container.getMappedPort(S3_PORT))}`,
    region: 'auto',
    bucket: 'voxlivre-it',
    accessKeyId,
    secretAccessKey,
    forcePathStyle: true,
  };
  const client = buildS3Client(options);
  await client.send(new CreateBucketCommand({ Bucket: options.bucket }));
  return {
    container,
    options,
    client,
    stop: async () => {
      client.destroy();
      await container.stop();
    },
  };
}
