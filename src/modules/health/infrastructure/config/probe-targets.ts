import { type ProbeConfig } from '@/modules/health/domain/value-objects/probe-config.vo';

/**
 * Sous-ensemble de l'env consommé pour construire les cibles. On ne passe pas
 * `ConfigService` entier : la fonction reste pure et testable.
 */
export interface ProbeTargetsEnv {
  readonly DATABASE_URL: string | undefined;
  readonly DB_HOST: string | undefined;
  readonly DB_PORT: number;
  readonly REDIS_URL: string | undefined;
  readonly REDIS_HOST: string | undefined;
  readonly REDIS_PORT: number;
}

/**
 * Dérive les cibles Postgres/Redis de l'env, en respectant la même règle que
 * `DrizzleModule` / `RedisModule` : l'URL (Railway) prime sur les composants.
 * Une URL illisible est traitée comme "non configuré" (le boot n'est pas le
 * bon endroit pour throw sur une sonde de santé).
 */
export function buildProbeTargets(env: ProbeTargetsEnv): readonly ProbeConfig[] {
  return [
    target('postgres', env.DATABASE_URL, env.DB_HOST, env.DB_PORT, 5432),
    target('redis', env.REDIS_URL, env.REDIS_HOST, env.REDIS_PORT, 6379),
  ];
}

function target(
  name: string,
  url: string | undefined,
  host: string | undefined,
  port: number,
  defaultPort: number,
): ProbeConfig {
  if (url !== undefined) {
    return fromUrl(name, url, defaultPort);
  }
  if (host === undefined || host === '') {
    return { name, configured: false };
  }
  return { name, configured: true, host, port };
}

function fromUrl(name: string, url: string, defaultPort: number): ProbeConfig {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { name, configured: false };
  }
  if (parsed.hostname === '') {
    return { name, configured: false };
  }
  const port = parsed.port === '' ? defaultPort : Number(parsed.port);
  return { name, configured: true, host: parsed.hostname, port };
}
