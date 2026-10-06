# Observability — voxlivre-api

> Simple, correct, **observable**. MVP sans OpenTelemetry : des logs
> structurés bien faits, un request-id partout, un slow-query logger et des
> health checks couvrent 90 % du besoin d'un solo dev sur Railway.

## Logger structuré (Pino)

`nestjs-pino` remplace le `Logger` Nest (`app.useLogger(app.get(PinoLogger))`).

- **JSON** en prod sur stdout **synchrone** (Railway agrège stdout ; le
  stream async perdait les dernières lignes au shutdown), `pino-pretty` en dev.
- Niveau : `LOG_LEVEL` sinon `info` en prod, `debug` ailleurs.
- **Redaction** : `authorization`, `cookie`, `*.password`, `*.token`,
  `*.otp`, `*.code`, `*.phone`, `*.email`, `*.secret`… → `[REDACTED]`.
- Sérialiseurs `req` / `res` réduits (`method`, `url`, `id`, `statusCode`).
- Niveau auto par status : 5xx → `error`, 4xx → `warn`, sinon `info`.

```ts
private readonly logger = new Logger(SynthesizeSegmentUseCase.name);
this.logger.log({ conversionId, segmentIndex, characters }, 'segment synthesized');
this.logger.error({ err, conversionId }, 'TTS provider failed');
```

### Règles

- **Jamais** `console.log` (ESLint) — `Logger` Nest, contexte = nom de classe.
- Un log = un événement, un objet de contexte, un message court en anglais.
- Pas de log dans `domain/` (TS pur) ; logs dans `application/` (décisions),
  `infrastructure/` (I/O, erreurs fournisseur), filter HTTP.
- `debug` pour le troubleshooting actif seulement.
- Jamais l'objet `req`, un body de webhook, un texte de document complet.

## Request-id & contexte (AsyncLocalStorage)

`requestContextMiddleware` (premier middleware Express) :

1. lit `x-request-id` entrant (le mobile peut en fournir un pour tracer un parcours) ou génère un UUID ;
2. l'écrit dans l'ALS (`requestContext.run`) ;
3. l'écho en header `x-request-id` de la réponse (exposé en CORS).

Conséquences : chaque ligne Pino de la requête porte `req.id` ; le filter RFC
7807 renvoie `requestId` au client ; le support retrouve les logs à partir
d'une capture d'écran de l'app. Les jobs BullMQ reçoivent `originRequestId`
dans leur payload et le remettent dans l'ALS.

## Slow-query logger (Postgres)

`instrumentPostgresClient` (`shared/observability/postgres-slow-query.ts`)
enveloppe le client `postgres-js` que Drizzle utilise :

- `> SLOW_QUERY_WARN_MS` (100) → `warn`, `> SLOW_QUERY_ERROR_MS` (500) → `error` ;
- statement SQL **paramétré** tronqué à 512 chars, jamais les valeurs ;
- logger `PostgresSlowQuery`.

Un `warn` récurrent = index manquant ou N+1 ; voir [performance-rules.md](performance-rules.md).

## Health checks

| Route                  | Rôle      | Détail                                                                                                                         |
| ---------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `GET /health`          | Liveness  | Healthcheck Railway. `200 { status: 'ok' }`.                                                                                   |
| `GET /health/services` | Readiness | Sonde TCP Postgres + Redis (timeouts courts). `503` si un service configuré est injoignable ; body détaillé dans les deux cas. |

Redis absent en dev = non configuré, pas "down". Un `503` ici pendant que
`/health` répond `200` = incident infra, pas crash app.

## Métriques (MVP = logs)

Pas de Prometheus au MVP. Les métriques business sont des **logs
structurés comptables**, requêtables dans Railway / un collecteur ultérieur :

| Événement              | Champs                                                  |
| ---------------------- | ------------------------------------------------------- |
| `tts.call`             | `provider`, `voiceId`, `characters`, `durationMs`, `ok` |
| `conversion.completed` | `conversionId`, `characters`, `totalDurationMs`         |
| `conversion.failed`    | `conversionId`, `step`, `code`                          |
| `quota.debited`        | `userId` (id, pas PII), `characters`, `remaining`       |
| `payment.webhook`      | `provider`, `eventId`, `result`                         |
| `otp.sent`             | `channel` (email/phone), jamais l'identifiant           |

Quand un collecteur arrive : `prom-client` sur `/metrics` protégé + RED par
route. Décision par ADR (coût Railway).

## Audit (actions sensibles)

Au MVP, même flux Pino avec `audit: true` : connexion, changement de rôle,
suppression de compte, crédit/débit de crédits, remboursement. Champs :
`actor`, `action`, `target`, `result`, `requestId`. Séparation dans un
stockage dédié quand la conformité l'exigera.

## Alerting (MVP manuel)

Railway : alertes plateforme (crash loop, CPU/RAM). Côté app, les signaux
à surveiller dans les logs, à brancher sur une alerte dès qu'un collecteur
existe :

| Signal                               | Seuil indicatif |
| ------------------------------------ | --------------- |
| `rate-limit … failing open`          | > 0 sur 5 min   |
| `slow_query` niveau `error`          | > 5 / 5 min     |
| `conversion.failed`                  | > 3 / 15 min    |
| Conversion `PENDING` > 15 min (cron) | > 0             |
| `/health/services` 503               | > 2 min         |
| Ratio `tts.call ok=false`            | > 5 %           |

## Anti-patterns

- ❌ `console.log`, `console.error`
- ❌ `logger.log('done')` sans contexte
- ❌ Logger un texte de document, un PDF en base64, un body de webhook
- ❌ Un `userId` remplacé par l'email ou le téléphone dans un log
- ❌ Middleware enregistré avant `configureRequestContext` (perd le request-id)
- ❌ Métrique/label à haute cardinalité (un label par utilisateur) le jour où Prometheus arrive
