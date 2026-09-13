import { z } from 'zod';

/**
 * Booléen "env-string" : `"true"` → true, `"false"` → false. Les env vars
 * sont toujours des strings ; on refuse `1`/`yes` pour éviter l'ambiguïté.
 */
const envBoolean = (defaultValue: boolean) =>
  z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .default(defaultValue);

/**
 * Secret optionnel : Railway (comme ECS) peut injecter une chaîne vide quand
 * la variable est déclarée sans valeur. On traite `""` comme absent pour ne
 * pas bloquer le boot sur un provider non encore configuré.
 */
const optionalSecret = () =>
  z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().min(1).optional(),
  );

/**
 * Source de vérité de toutes les variables d'environnement consommées par
 * l'application. Validée au boot via {@link validateEnv} — si une variable
 * est invalide ou manquante (hors `optional`), l'application throw et ne
 * démarre pas.
 *
 * Pourquoi : interdit le silent fallback à `undefined` qui masque les
 * misconfigurations en prod (cf. security-baseline "Aucun hardcode").
 *
 * Convention Voxlivre : chaque module métier qui a besoin d'une variable
 * l'ajoute ICI (section dédiée + commentaire). Ce fichier ne contient que ce
 * qui est réellement consommé — pas de variable "au cas où".
 */
export const envSchema = z
  .object({
    // ------------------------------------------------------------------
    // Runtime
    // ------------------------------------------------------------------
    // NODE_ENV = mode runtime Node (convention écosystème). APP_ENV = nom de
    // l'environnement de déploiement (local, staging, production…).
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_ENV: z.string().min(1).default('development'),
    PORT: z.coerce.number().int().nonnegative().default(8080),
    // `0.0.0.0` requis dans un conteneur (Railway) pour être joignable par
    // le proxy ; en local on peut binder `127.0.0.1`.
    HOST: z.string().min(1).default('0.0.0.0'),
    // Nombre de proxies à truster pour `X-Forwarded-For` (Express
    // `trust proxy`). 0 en local, 1 derrière le proxy Railway. Sans ça,
    // `req.ip` = IP du proxy et le rate-limit s'applique en bloc.
    TRUST_PROXY_HOPS: z.coerce.number().int().nonnegative().default(0),

    // ------------------------------------------------------------------
    // PostgreSQL — deux formes acceptées (cf. superRefine plus bas) :
    //   1. `DATABASE_URL` (injecté par Railway) — prioritaire si présent.
    //   2. Composants `DB_*` (docker-compose local, ou secrets séparés).
    // ------------------------------------------------------------------
    DATABASE_URL: optionalSecret(),
    DB_HOST: z.string().min(1).optional(),
    DB_PORT: z.coerce.number().int().positive().default(5432),
    DB_NAME: z.string().min(1).optional(),
    DB_USER: z.string().min(1).optional(),
    DB_PASSWORD: z.string().default(''),
    DB_POOL_MAX: z.coerce.number().int().positive().default(10),
    // TLS driver. `true` → connexion chiffrée sans vérification du cert
    // (Railway interne). Local docker sans SSL → false.
    DB_SSL: envBoolean(false),

    // ------------------------------------------------------------------
    // Redis — même logique : `REDIS_URL` (Railway) ou `REDIS_HOST`/`PORT`.
    // Optionnel en dev (boot dégradé : rate-limit in-memory, pas de queue).
    // Requis en production (superRefine) : un store in-memory est bypassable
    // par scaling horizontal, et BullMQ en dépend.
    // ------------------------------------------------------------------
    REDIS_URL: optionalSecret(),
    REDIS_HOST: z.string().min(1).optional(),
    REDIS_PORT: z.coerce.number().int().positive().default(6379),
    REDIS_TLS: envBoolean(false),

    // ------------------------------------------------------------------
    // Surface HTTP
    // ------------------------------------------------------------------
    // Swagger : activé hors `production` par défaut ; en prod opt-in explicite
    // (la spec dévoile la surface d'API).
    SWAGGER_ENABLED: z
      .enum(['true', 'false'])
      .transform((v) => v === 'true')
      .optional(),
    // Origines CORS autorisées, séparées par virgule. Vide → aucune origine
    // cross-origin (le fallback dev localhost est appliqué hors production).
    CORS_ALLOWED_ORIGINS: z
      .string()
      .default('')
      .transform((v) =>
        v
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0),
      ),
    // Rate limiting global (bucket par IP). Buckets dérogatoires déclarés au
    // niveau des contrôleurs via `@Throttle()`.
    RATE_LIMIT_TTL_MS: z.coerce.number().int().positive().default(1000),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),

    // ------------------------------------------------------------------
    // Observabilité
    // ------------------------------------------------------------------
    LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).optional(),
    SLOW_QUERY_WARN_MS: z.coerce.number().int().positive().default(100),
    SLOW_QUERY_ERROR_MS: z.coerce.number().int().positive().default(500),

    // ------------------------------------------------------------------
    // Sécurité applicative
    // ------------------------------------------------------------------
    // Secret HMAC des cursors de pagination (ADR-0007). ≥ 32 chars. Optionnel
    // en dev (fallback déterministe), requis en production.
    CURSOR_HMAC_SECRET: z.string().min(32).optional(),
    // ------------------------------------------------------------------
    // Identity (better-auth, OTP email/téléphone — RF-16, DEC-09)
    // ------------------------------------------------------------------
    // Secret de signature des sessions/tokens bearer et URL publique de l'API.
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.url(),
    // Origines de confiance supplémentaires pour better-auth (CSRF origin
    // check). Vide par défaut : l'app mobile n'envoie pas d'Origin.
    BETTER_AUTH_TRUSTED_ORIGINS: z
      .string()
      .default('')
      .transform((v) =>
        v
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0),
      ),
    // Paramètres OTP (décisions identity : 6 chiffres, 5 min, 3 essais).
    OTP_LENGTH: z.coerce.number().int().min(4).max(8).default(6),
    OTP_EXPIRES_IN_SECONDS: z.coerce.number().int().positive().default(300),
    OTP_ALLOWED_ATTEMPTS: z.coerce.number().int().positive().default(3),
    // Livraison du code : `log` (dev — code écrit dans les logs) ou
    // `notification` (à venir : email/SMS via le module notification).
    // En production, `log` est refusé sauf `OTP_LOG_DELIVERY_UNSAFE_ALLOW=true`.
    OTP_DELIVERY_MODE: z.enum(['log', 'notification']).default('log'),
    // Store des compteurs de rate-limit better-auth. `database` (défaut :
    // partagé entre instances, sans dépendre de Redis) ; `memory` pour les
    // e2e sans base. Imposé `database` en production (superRefine).
    AUTH_RATE_LIMIT_STORAGE: z.enum(['database', 'memory']).default('database'),
    OTP_LOG_DELIVERY_UNSAFE_ALLOW: envBoolean(false),
    // Durée de session (mobile offline-first : 30 j) et fréquence de
    // rafraîchissement de l'expiration à l'usage (1 j).
    SESSION_EXPIRES_IN_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(60 * 60 * 24 * 30),
    SESSION_UPDATE_AGE_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(60 * 60 * 24),
  })
  .superRefine((env, ctx) => {
    // --- Postgres : URL ou composants, jamais rien -----------------------
    const hasComponents =
      env.DB_HOST !== undefined && env.DB_NAME !== undefined && env.DB_USER !== undefined;
    if (env.DATABASE_URL === undefined && !hasComponents) {
      ctx.addIssue({
        code: 'custom',
        path: ['DATABASE_URL'],
        message: 'Provide DATABASE_URL, or DB_HOST + DB_NAME + DB_USER.',
      });
    }

    if (env.NODE_ENV !== 'production') return;

    // --- Contraintes production ------------------------------------------
    for (const rule of PRODUCTION_RULES) {
      if (rule.missing(env)) {
        ctx.addIssue({ code: 'custom', path: [rule.path], message: rule.message });
      }
    }
  });

type RawEnv = z.input<typeof envSchema>;

/**
 * Variables obligatoires uniquement en `NODE_ENV=production`. Déclaratif
 * pour que l'ajout d'une contrainte soit une ligne, pas un `if` de plus.
 */
const PRODUCTION_RULES: readonly {
  readonly path: keyof RawEnv;
  readonly missing: (env: z.output<typeof envSchema>) => boolean;
  readonly message: string;
}[] = [
  {
    path: 'REDIS_URL',
    missing: (env) => env.REDIS_URL === undefined && env.REDIS_HOST === undefined,
    message:
      'REDIS_URL (or REDIS_HOST) is required when NODE_ENV=production (rate-limit store + BullMQ).',
  },
  {
    path: 'CURSOR_HMAC_SECRET',
    missing: (env) => env.CURSOR_HMAC_SECRET === undefined,
    message: 'CURSOR_HMAC_SECRET is required when NODE_ENV=production (cursor signing).',
  },
  {
    path: 'AUTH_RATE_LIMIT_STORAGE',
    missing: (env) => env.AUTH_RATE_LIMIT_STORAGE !== 'database',
    message: 'AUTH_RATE_LIMIT_STORAGE must be "database" when NODE_ENV=production.',
  },
  {
    path: 'OTP_DELIVERY_MODE',
    missing: (env) => env.OTP_DELIVERY_MODE === 'log' && !env.OTP_LOG_DELIVERY_UNSAFE_ALLOW,
    message:
      'OTP_DELIVERY_MODE=log writes one-time codes to the logs; refused in production unless OTP_LOG_DELIVERY_UNSAFE_ALLOW=true.',
  },
];

export type Env = z.infer<typeof envSchema>;

/**
 * Valide `process.env` et renvoie un objet typé. À passer au `validate:`
 * de `ConfigModule.forRoot`. Throw au boot si l'env est invalide.
 */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  return result.data;
}
