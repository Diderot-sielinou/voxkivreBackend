import { createHmac } from 'node:crypto';

/** Libellé de dérivation : change le secret dérivé sans toucher la source. */
const DERIVATION_LABEL = 'voxlivre:cursor-hmac:dev-fallback';

/**
 * Secret HMAC des cursors. `CURSOR_HMAC_SECRET` s'il est fourni (obligatoire
 * en production, cf. `PRODUCTION_RULES`) ; sinon, en dev/test, un secret
 * **dérivé** de `BETTER_AUTH_SECRET` — déterministe (les cursors survivent
 * à un redémarrage) et sans secret écrit en dur dans le code.
 */
export function resolveCursorSecret(env: {
  readonly CURSOR_HMAC_SECRET: string | undefined;
  readonly BETTER_AUTH_SECRET: string;
}): string {
  if (env.CURSOR_HMAC_SECRET !== undefined) return env.CURSOR_HMAC_SECRET;
  return createHmac('sha256', env.BETTER_AUTH_SECRET).update(DERIVATION_LABEL).digest('base64url');
}
