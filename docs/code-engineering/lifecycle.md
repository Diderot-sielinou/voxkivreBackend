# Lifecycle & Graceful Shutdown — voxlivre-api

Railway redéploie en envoyant `SIGTERM` au container puis `SIGKILL` après un
délai court. Un worker BullMQ tué en pleine synthèse TTS = un job à
re-exécuter ; c'est pour ça que chaque étape est idempotente
([jobs-and-pipeline.md](jobs-and-pipeline.md)) **et** que l'app se ferme
proprement.

## Hooks Nest

| Hook                        | Quand                                    | Usage Voxlivre                                                     |
| --------------------------- | ---------------------------------------- | ------------------------------------------------------------------ |
| `OnModuleInit`              | Module + dépendances prêts               | Log d'initialisation, vérification de config. **Pas d'I/O.**       |
| `OnApplicationBootstrap`    | Tous les modules initialisés             | Démarrer un worker BullMQ, planifier un cron (`@nestjs/schedule`)  |
| `BeforeApplicationShutdown` | Signal reçu, avant fermeture des modules | Marquer "draining" (à venir avec un LB devant plusieurs instances) |
| `OnApplicationShutdown`     | Après fermeture des modules              | Fermer pool Postgres, Redis, workers BullMQ                        |

### Règles

- **Pas de gros travail au boot** : pas de migration (`node dist/migrate` est
  un pré-déploiement séparé), pas de warm-up de cache, pas de ping de
  fournisseur. Le container doit répondre à `/health` en < 2 s.
- **Connexions lazy** : Postgres (`postgres-js`) et Redis (`lazyConnect: true`)
  n'ouvrent une socket qu'à la première commande. L'app boote sans DB ni
  Redis (e2e, dev dégradé sans Redis → rate-limit in-memory).
- **Pas d'I/O long** dans `OnApplicationShutdown` : le pool se ferme avec
  `timeout: 5` s, `redis.quit()` flush puis ferme.

## `main.ts` — ce qui est en place

```ts
const app = await NestFactory.create<NestExpressApplication>(AppModule, {
  bufferLogs: true, // logs tamponnés jusqu'à Pino
  rawBody: true, // signature HMAC des webhooks Mobile Money sur le corps brut
});
app.useLogger(app.get(PinoLogger));
app.enableShutdownHooks(); // sans ça, OnApplicationShutdown ne tourne pas sur SIGTERM

configureExpress(app); // trust proxy
configureSecurity(app); // helmet + cookie-parser
configureRequestContext(app); // ALS request-id — AVANT tout le reste
configureCors(app);
configureAuth(app); // better-auth : AVANT body-parser (lit le corps brut)
configureBodyParser(app);
configureApi(app); // versioning, ValidationPipe, filter RFC 7807
await configureSwagger(app);
```

L'ordre des `configureX` est **sensible** (Express exécute les middlewares
dans l'ordre d'enregistrement). Chaque fonction de `src/bootstrap/` documente
sa contrainte de position ; `test/support/bootstrap-test-app.ts` réutilise les
mêmes fonctions pour que les e2e suivent `main.ts` automatiquement.

## Fermeture des ressources

Pattern à reproduire pour toute ressource réseau (cf. `DrizzleModule`,
`RedisModule`) :

```ts
@Global()
@Module({ providers: [/* factory lazy */], exports: [REDIS_CLIENT] })
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}
  async onApplicationShutdown(): Promise<void> {
    this.logger.log('Closing Redis connection');
    await this.redis.quit(); // jamais ouverte (lazyConnect) → résout sans I/O
  }
}
```

Workers BullMQ : `await worker.close()` — attend la fin du job en cours
(borné par le `lockDuration`), puis libère. Un job interrompu est repris par
le prochain worker : d'où l'idempotence obligatoire.

## Health checks

| Route                  | Rôle                                    | Réponse                                          |
| ---------------------- | --------------------------------------- | ------------------------------------------------ |
| `GET /health`          | Liveness — healthcheck Railway          | `200 { status: 'ok' }` tant que Node tourne      |
| `GET /health/services` | Readiness — Postgres / Redis joignables | `200` ou `503` (body détaillé dans les deux cas) |

Les deux sont `VERSION_NEUTRAL` (pas de `/v1`) et **publics**. Railway ne
lit que le status. Voir `src/modules/health/` (module gabarit) et
[observability.md](observability.md).

## Deux processus, un seul code

L'API HTTP et les workers BullMQ sont lancés par le **même** `AppModule`
(un seul service Railway au MVP). Si les workers doivent scaler séparément
(pics de conversion), on lancera une seconde instance avec un flag d'env qui
n'enregistre que les processors — décision à tracer par ADR, pas de fork du
code. Ce flag existe : `JOB_WORKERS_ENABLED` (ADR-0009, critère de
bascule documenté). Les workers démarrent en `OnApplicationBootstrap` et
se ferment en `OnApplicationShutdown` (connexion Redis comprise).

## Anti-patterns

- ❌ `bootstrap()` sans `void` → unhandled promise au crash
- ❌ `process.exit()` dans un hook (le seul `process.exit` légitime est le
  script CLI `migrate.ts`, qui gate le déploiement par son exit code)
- ❌ Migration ou seed dans `OnModuleInit`
- ❌ `await redis.ping()` au boot "pour vérifier" — casse le boot sans Redis
- ❌ Worker BullMQ non fermé → job en cours retry sur un autre worker **pendant** qu'il tourne encore
- ❌ Ajouter un `app.use(...)` dans `main.ts` sans passer par une fonction `configureX` (les e2e ne le verraient pas)
