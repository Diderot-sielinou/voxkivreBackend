import { performance } from 'node:perf_hooks';

import { SLOW_QUERY_STATEMENT_MAX_LEN } from './observability.constants';

import type { PendingQuery, Row, Sql } from 'postgres';

export interface SlowQueryThresholds {
  readonly warnMs: number;
  readonly errorMs: number;
}

/** Logger minimal, découplé de Nest (wiré au boot, avant l'injecteur). */
export interface SlowQueryLogger {
  warn(message: string): void;
  error(message: string): void;
}

type UnsafeImpl = (
  this: Sql,
  query: string,
  params?: unknown[],
  options?: { prepare?: boolean },
) => PendingQuery<Row[]>;

/**
 * Wrappe un client `postgres-js` pour chronométrer chaque
 * `.unsafe(sql, params).execute()` (la seule porte d'entrée de Drizzle vers
 * le driver) et logger warn/error au-delà des seuils.
 *
 * Pourquoi : une requête lente sur la bibliothèque ou le décompte de quota
 * doit être visible AVANT que l'utilisateur ne s'en plaigne. Pas d'OTel au
 * MVP — ce wrapper de 60 lignes couvre 90 % du besoin.
 */
export function instrumentPostgresClient(
  client: Sql,
  thresholds: SlowQueryThresholds,
  logger: SlowQueryLogger,
): Sql {
  return new Proxy(client, {
    get(target, prop, receiver) {
      const value: unknown = Reflect.get(target, prop, receiver);
      if (prop !== 'unsafe' || typeof value !== 'function') return value;
      return wrapUnsafe(value as UnsafeImpl, target, thresholds, logger);
    },
  });
}

function wrapUnsafe(
  unsafe: UnsafeImpl,
  bindTarget: Sql,
  thresholds: SlowQueryThresholds,
  logger: SlowQueryLogger,
): Sql['unsafe'] {
  const wrapped: UnsafeImpl = function unsafeTimed(
    this: Sql,
    query: string,
    params?: unknown[],
    options?: { prepare?: boolean },
  ): PendingQuery<Row[]> {
    const start = performance.now();
    const handle = unsafe.call(bindTarget, query, params, options);

    // `execute()` est typé `this` (le query object, thenable) ; on ne
    // s'intéresse qu'à sa nature de promesse de `Row[]`.
    const originalExecute = handle.execute.bind(handle) as () => PromiseLike<Row[]>;
    let measured = false;
    const record = (errored: boolean): void => {
      if (measured) return;
      measured = true;
      logIfSlow(performance.now() - start, query, errored, thresholds, logger);
    };

    // Invariant : Drizzle fait `await client.unsafe(...).execute()` — il ne
    // consomme que la thenable-ness du retour. Une `Promise<Row[]>` est
    // donc substituable au query object, d'où le cast à la frontière.
    handle.execute = ((): Promise<Row[]> =>
      Promise.resolve(originalExecute()).then(
        (value: Row[]) => {
          record(false);
          return value;
        },
        (error: unknown) => {
          record(true);
          throw error;
        },
      )) as unknown as typeof handle.execute;

    return handle;
  };

  return wrapped as Sql['unsafe'];
}

function logIfSlow(
  durationMs: number,
  query: string,
  errored: boolean,
  thresholds: SlowQueryThresholds,
  logger: SlowQueryLogger,
): void {
  if (durationMs < thresholds.warnMs) return;

  const truncated =
    query.length > SLOW_QUERY_STATEMENT_MAX_LEN
      ? `${query.slice(0, SLOW_QUERY_STATEMENT_MAX_LEN)}…`
      : query;
  const message =
    `slow_query duration_ms=${durationMs.toFixed(1)}` +
    ` threshold_warn_ms=${String(thresholds.warnMs)}` +
    ` errored=${String(errored)} statement="${truncated}"`;

  if (durationMs >= thresholds.errorMs) {
    logger.error(message);
  } else {
    logger.warn(message);
  }
}
