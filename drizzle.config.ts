import { defineConfig } from 'drizzle-kit';

// drizzle-kit ne passe pas par le schéma Zod — il lit les env vars
// directement. Même règle qu'au runtime : `DATABASE_URL` prime, sinon on
// compose une URL depuis les composants `DB_*`.
function resolveDatabaseUrl(): string {
  const fromEnv = process.env.DATABASE_URL;
  if (fromEnv !== undefined && fromEnv.trim() !== '') return fromEnv;

  const host = process.env.DB_HOST ?? 'localhost';
  const port = process.env.DB_PORT ?? '5432';
  const database = process.env.DB_NAME ?? 'voxlivre';
  const user = process.env.DB_USER ?? 'voxlivre';
  const password = process.env.DB_PASSWORD ?? '';
  const sslQuery = process.env.DB_SSL === 'true' ? '?sslmode=require' : '';
  const auth = password === '' ? user : `${user}:${encodeURIComponent(password)}`;
  return `postgres://${auth}@${host}:${port}/${database}${sslQuery}`;
}

export default defineConfig({
  // Glob : tout `*.schema.ts` sous `infrastructure/persistence/schema` de
  // chaque module. Ajouter un schéma = créer le fichier, sans toucher ici.
  schema: './src/modules/*/infrastructure/persistence/schema/*.schema.ts',
  out: './src/shared/persistence/migrations',
  dialect: 'postgresql',
  dbCredentials: { url: resolveDatabaseUrl() },
});
