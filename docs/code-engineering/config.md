# Configuration & secrets — voxlivre-api

Toute la configuration runtime passe par des **variables d'environnement**
validées par Zod au boot. Aucun hardcode (secret, URL, ID) dans le code.

## Architecture

```
src/shared/config/
├── env.schema.ts         # source de vérité Zod : envSchema, Env, validateEnv(), PRODUCTION_RULES
├── app-config.module.ts  # @Global, ConfigModule.forRoot({ validate: validateEnv })
└── index.ts
src/shared/constants/     # conventions de code (API_DEFAULT_VERSION, SWAGGER_PATH, HSTS…) — PAS de l'env
```

- **Schéma Zod** = source de vérité. Type `Env` dérivé (`z.infer`).
- **Fail-fast** : variable manquante ou invalide → l'app throw et ne démarre pas.
- **Typage strict** : `ConfigService<Env, true>` — `config.get('PORT', { infer: true })` renvoie `number`.
- **Env vs constantes** : ce qui varie par environnement (port, URLs, secrets,
  seuils) est dans `Env` ; ce qui est une convention de code fixée par ADR
  (`/v1`, chemin Swagger, nom du bucket throttler) est dans `shared/constants/`.

## Lecture

```ts
@Injectable()
export class GoogleTtsAdapter implements TtsPort {
  constructor(private readonly config: ConfigService<Env, true>) {}
  private get projectId() {
    return this.config.get('GOOGLE_TTS_PROJECT_ID', { infer: true });
  }
}

// factory de module
{
  provide: REDIS_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService<Env, true>) => { /* buildRedisOptions(config) */ },
}
```

## Deux formes pour Postgres et Redis (ADR-0003)

Railway injecte `DATABASE_URL` / `REDIS_URL` ; le docker-compose local
utilise `DB_*` / `REDIS_*`. Le schéma accepte les deux, **l'URL prime**.
Trois consommateurs appliquent la même règle : `DrizzleModule`, `RedisModule`
(+ `RateLimitRedisModule`) et `drizzle.config.ts` (drizzle-kit ne passe pas
par Zod). Toute nouvelle dépendance réseau suit ce pattern.

## Règles de production (`PRODUCTION_RULES`)

Déclaratif : une contrainte = une ligne, pas un `if`. Actuellement en
`NODE_ENV=production` :

- `REDIS_URL` ou `REDIS_HOST` requis (rate-limit partagé + BullMQ) ;
- `CURSOR_HMAC_SECRET` requis (signature des cursors) ;
- `AUTH_RATE_LIMIT_STORAGE=database` imposé ;
- `OTP_DELIVERY_MODE=log` refusé (sauf `OTP_LOG_DELIVERY_UNSAFE_ALLOW=true`).
- `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` requis
  (stockage objet R2, ADR-0007).

Un secret "optionnel en dev, requis en prod" se déclare `optional()` dans le
schéma + une règle ici — jamais un default de prod dans le code.

## Ajouter une variable

1. Elle est **réellement consommée** par du code de cette PR. Sinon, non (AGENTS.md).
2. Déclarer dans `env.schema.ts` : section du module, commentaire "pourquoi",
   `coerce.number()` pour les nombres, `envBoolean()` pour les booléens,
   `optionalSecret()` pour un secret que Railway peut injecter vide,
   `.min(1)` sur toute string obligatoire.
3. Documenter dans `.env.example` (valeur neutre ou placeholder, commentaire d'usage).
4. Si obligatoire en prod seulement → `PRODUCTION_RULES`.
5. Test dans `env.schema.spec.ts` si la règle a une branche (default, refine).
6. Ajouter la variable dans le service Railway **avant** de merger.

## Environnements

| Environnement  | Source                                        | `.env` lu ?                           |
| -------------- | --------------------------------------------- | ------------------------------------- |
| dev            | `.env` à la racine (`cp .env.example .env`)   | oui                                   |
| test (Jest)    | `test/e2e/setup-env.ts` + `process.env` shell | **non** (hermétique, `ignoreEnvFile`) |
| prod (Railway) | Variables du service Railway                  | non                                   |

Pourquoi `.env` ignoré en test : sinon `REDIS_HOST` local branche le
throttler sur le vrai Redis du compose et les e2e deviennent non
déterministes.

## Secrets

- Dev : `.env` local, gitignored. `.env.example` ne contient **que** des
  placeholders (`change-me-…`) — jamais une vraie clé, même de sandbox.
- Prod : variables Railway (chiffrées côté plateforme). Le code lit une env
  var comme les autres — pas d'appel SDK de secret manager au boot.
- Rotation : changer la variable Railway → redeploy. Les secrets HMAC
  (`CURSOR_HMAC_SECRET`, `BETTER_AUTH_SECRET`) invalident cursors/sessions en
  cours : annoncer, faire en heure creuse.
- Secrets ≥ 32 chars : `openssl rand -base64 48`.
- Leak avéré : rotation immédiate, puis purge de l'historique git.

## Anti-patterns

- ❌ `process.env.X` hors `env.schema.ts`, `app-config.module.ts`, `drizzle.config.ts`, `migrate.ts`
- ❌ `process.env.X ?? 'valeur-prod'`
- ❌ `parseInt(process.env.PORT)` (le schéma coerce et valide)
- ❌ Variable ajoutée "au cas où", sans consommateur
- ❌ Littéral d'URL / ID fournisseur dans un adapter
- ❌ `.env` committé ; clé de sandbox dans `.env.example`
