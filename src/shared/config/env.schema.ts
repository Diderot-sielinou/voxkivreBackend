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
    // Secret HMAC des cursors de pagination (ADR-0005). ≥ 32 chars. Optionnel
    // en dev (fallback déterministe dérivé de BETTER_AUTH_SECRET, cf.
    // shared/pagination/cursor-secret.ts), requis en production.
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
    // `notification` (module notification : e-mail via SES, SMS via Orange).
    // En production, `log` est refusé sauf `OTP_LOG_DELIVERY_UNSAFE_ALLOW=true`.
    OTP_DELIVERY_MODE: z.enum(['log', 'notification']).default('log'),
    // Expéditeur des e-mails OTP : identité vérifiée dans SES (même région
    // qu'`AWS_REGION`). Requis avec `OTP_DELIVERY_MODE=notification`.
    OTP_EMAIL_FROM: z.email().optional(),
    // Store des compteurs de rate-limit better-auth. `database` (défaut :
    // partagé entre instances, sans dépendre de Redis) ; `memory` pour les
    // e2e sans base. Imposé `database` en production (superRefine).
    AUTH_RATE_LIMIT_STORAGE: z.enum(['database', 'memory']).default('database'),
    // SMS par l'API Orange Cameroun (ADR-0017). Identifiants de l'application
    // Orange Developer, les deux ou aucun ; absents → SMS non livrés (alerte
    // au boot). Posés dans SSM par le porteur, jamais dans le dépôt.
    ORANGE_SMS_CLIENT_ID: optionalSecret(),
    ORANGE_SMS_CLIENT_SECRET: optionalSecret(),
    // Nom d'expéditeur approuvé par Orange (sinon l'envoi échoue en 400) :
    // 11 caractères alphanumériques au plus. Absent → numéro par défaut.
    ORANGE_SMS_SENDER_NAME: z
      .string()
      .regex(/^[A-Za-z0-9]{1,11}$/, 'ORANGE_SMS_SENDER_NAME: 1 to 11 letters or digits')
      .optional(),
    // Plafond global de SMS par journée UTC (garde-fou de coût, ADR-0017).
    SMS_DAILY_LIMIT: z.coerce.number().int().positive().default(300),
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

    // ------------------------------------------------------------------
    // Stockage objet S3-compatible (ADR-0007, ADR-0012) — deux formes :
    //   1. S3 natif d'AWS : `S3_BUCKET` seul ; région `AWS_REGION`,
    //      identifiants par la chaîne par défaut du SDK (rôle d'instance).
    //   2. Autre fournisseur (RustFS en local, R2) : `S3_ENDPOINT` + clés.
    // Optionnel en dev : absent → les routes qui en dépendent répondent 503
    // `INFRASTRUCTURE_STORAGE_NOT_CONFIGURED`. `S3_BUCKET` requis en production.
    // ------------------------------------------------------------------
    // RustFS : `http://localhost:9002` ; R2 : `https://<account-id>.r2.cloudflarestorage.com`.
    S3_ENDPOINT: z.url().optional(),
    // Région quand `S3_ENDPOINT` est fourni (R2 : `auto`, RustFS : indifférent).
    S3_REGION: z.string().min(1).default('auto'),
    S3_BUCKET: z.string().min(1).optional(),
    // Clés d'un fournisseur hors AWS, toutes les deux ou aucune.
    S3_ACCESS_KEY_ID: optionalSecret(),
    S3_SECRET_ACCESS_KEY: optionalSecret(),
    // `true` pour RustFS/MinIO (`http://host/bucket/key`) ; R2 accepte les deux.
    S3_FORCE_PATH_STYLE: envBoolean(false),

    // ------------------------------------------------------------------
    // Tâches asynchrones (ADR-0009)
    // ------------------------------------------------------------------
    // L'API et les workers BullMQ tournent dans le même processus au MVP.
    // `false` : le processus ne consomme aucune file (e2e hermétiques ; plus
    // tard, une instance "API seule" quand les workers auront leur service).
    JOB_WORKERS_ENABLED: envBoolean(true),

    // ------------------------------------------------------------------
    // Documents (RF-01)
    // ------------------------------------------------------------------
    // Taille max d'un PDF importé. 50 Mo couvre un manuel scanné d'environ
    // 200 pages (RNF-01) ; imposée par la signature de l'URL d'upload.
    DOCUMENT_MAX_SIZE_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .default(50 * 1024 * 1024),

    // ------------------------------------------------------------------
    // Synthèse vocale — Amazon Polly (ADR-0013)
    // ------------------------------------------------------------------
    // `fake` (dev, CI) : silence MP3 et horodatages calculés, rien n'est
    // facturé. `polly` : imposé en production. Les identifiants AWS ne sont
    // jamais ici : chaîne par défaut du SDK (profil en local, rôle d'instance
    // en production, ADR-0012).
    TTS_PROVIDER: z.enum(['fake', 'polly']).default('fake'),
    // Région des services AWS appelés par l'application (Polly). Lue aussi
    // directement par le SDK ; requise quand `TTS_PROVIDER=polly`.
    AWS_REGION: z.string().min(1).optional(),

    // ------------------------------------------------------------------
    // Quota (RF-24, RNF-25, ADR-0010, ADR-0019) — valeurs de départ en
    // attendant l'étude de prix (SDD §13.1).
    // ------------------------------------------------------------------
    // Palier gratuit par mois civil (UTC), en unités, voix standard seulement
    // (1 unité = 1 caractère) : ~25 pages, ≈ 240 FCFA de Polly au pire.
    FREE_TIER_UNITS_PER_MONTH: z.coerce.number().int().nonnegative().default(50_000),
    // Plafond d'une conversion, quel que soit le quota disponible (~400 pages).
    MAX_CHARS_PER_CONVERSION: z.coerce.number().int().positive().default(1_000_000),
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

    // --- Cohérence des services externes (S3, SES, Polly, Orange) --------
    for (const rule of CONSISTENCY_RULES) {
      if (rule.violated(env)) {
        ctx.addIssue({ code: 'custom', path: [rule.path], message: rule.message });
      }
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
 * Règles de cohérence valables dans tous les environnements : une
 * combinaison incomplète échoue au boot plutôt qu'au premier appel du SDK.
 */
const CONSISTENCY_RULES: readonly {
  readonly path: keyof RawEnv;
  readonly violated: (env: z.output<typeof envSchema>) => boolean;
  readonly message: string;
}[] = [
  {
    path: 'ORANGE_SMS_CLIENT_ID',
    violated: (env) =>
      (env.ORANGE_SMS_CLIENT_ID === undefined) !== (env.ORANGE_SMS_CLIENT_SECRET === undefined),
    message: 'Provide both ORANGE_SMS_CLIENT_ID and ORANGE_SMS_CLIENT_SECRET, or neither.',
  },
  {
    path: 'S3_ACCESS_KEY_ID',
    violated: (env) =>
      (env.S3_ACCESS_KEY_ID === undefined) !== (env.S3_SECRET_ACCESS_KEY === undefined),
    message:
      'Provide both S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY, or neither (AWS default credentials).',
  },
  {
    path: 'AWS_REGION',
    violated: (env) =>
      env.S3_BUCKET !== undefined && env.S3_ENDPOINT === undefined && env.AWS_REGION === undefined,
    message: 'AWS_REGION is required for native S3 (S3_BUCKET without S3_ENDPOINT).',
  },
  {
    path: 'OTP_EMAIL_FROM',
    violated: (env) => env.OTP_DELIVERY_MODE === 'notification' && env.OTP_EMAIL_FROM === undefined,
    message:
      'OTP_EMAIL_FROM (a sender verified in SES) is required when OTP_DELIVERY_MODE=notification.',
  },
  {
    path: 'AWS_REGION',
    violated: (env) => env.OTP_DELIVERY_MODE === 'notification' && env.AWS_REGION === undefined,
    message: 'AWS_REGION is required when OTP_DELIVERY_MODE=notification (Amazon SES).',
  },
  {
    path: 'AWS_REGION',
    violated: (env) => env.TTS_PROVIDER === 'polly' && env.AWS_REGION === undefined,
    message: 'AWS_REGION is required when TTS_PROVIDER=polly.',
  },
];

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
    path: 'S3_BUCKET',
    missing: (env) => env.S3_BUCKET === undefined,
    message: 'S3_BUCKET is required when NODE_ENV=production (object storage).',
  },
  {
    path: 'TTS_PROVIDER',
    missing: (env) => env.TTS_PROVIDER !== 'polly',
    message:
      'TTS_PROVIDER must be "polly" when NODE_ENV=production (the fake engine produces silence).',
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
