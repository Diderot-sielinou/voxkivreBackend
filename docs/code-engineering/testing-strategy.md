# Testing Strategy — voxlivre-api

## Pyramide

```
       /\
      /e2\          Peu : wiring HTTP complet, ports fakés (5-20 scénarios)
     /----\
    /  int \        Chaque adapter d'infra contre un service réel (Testcontainers)
   /--------\
  /   unit   \     Beaucoup : domain + application + kernel, ~100 %
 /------------\
```

## 3 couches, 3 configs Jest

| Couche      | Fichiers                 | Config                       | Commande        | Docker  |
| ----------- | ------------------------ | ---------------------------- | --------------- | ------- |
| Unit        | `src/**/*.spec.ts`       | `test/jest-unit.json`        | `pnpm test`     | non     |
| Intégration | `src/**/*.int.spec.ts`   | `test/jest-integration.json` | `pnpm test:int` | **oui** |
| E2E         | `test/e2e/*.e2e-spec.ts` | `test/jest-e2e.json`         | `pnpm test:e2e` | non     |

`pnpm test:all` = unit + e2e (hook pre-push). `test:int` est manuel / CI
(Testcontainers a besoin de Docker).

### Unit — `domain/` + `application/` + `shared/kernel`

Zéro Nest, zéro DB. Ports remplacés par de simples objets typés.

```ts
it('returns USER_NOT_FOUND when missing', async () => {
  const users: UserQueryPort = { findById: () => Promise.resolve(null) };
  const r = await new GetCurrentUserUseCase(users).execute(UserId.of('ghost'));
  expect(r.isErr()).toBe(true);
  expect(r.error.code).toBe(IDENTITY_ERROR_CODES.USER_NOT_FOUND);
});
```

- Cible : ~100 % sur `domain/`, `application/`, `shared/kernel`, `shared/http`.
- Le temps vient de `ClockPort` (fake) — jamais `new Date()` à mocker.
- Un test par branche d'erreur ; on teste le **code**, pas le message.

### Intégration — `infrastructure/`

Un adapter est testé contre le **vrai** service : Postgres via
`startMigratedPostgres()` (`test/support/testcontainers.ts`, applique toutes
les migrations du repo), Redis via `@testcontainers/redis`, stockage objet
S3 via `startS3Storage()` (RustFS, même image que le docker-compose, bucket
créé — ADR-0007). Un faux SDK S3 ne prouverait rien : ce qu'on teste
(taille signée dans l'URL d'upload, 404 → `null`) est le comportement du
**serveur**.

```ts
let pg: StartedPostgres;
beforeAll(async () => {
  pg = await startMigratedPostgres();
}, 60_000);
afterAll(async () => {
  await pg.stop();
});

it('persists then reads back', async () => {
  const sut = new DrizzleUserQuery(pg.db);
  /* … */
});
```

- Un mock de Postgres ne détecte ni contrainte, ni migration cassée, ni SQL faux.
- Fournisseurs externes (TTS, OCR, Mobile Money, R2) : **pas** de test
  d'intégration contre le vrai fournisseur en CI (coût, quota). Adapter testé
  contre un fake HTTP local (`nock`/`msw`) ou un serveur S3 compatible en
  container ; un smoke test manuel documenté par adapter.
- `better-auth.int.spec.ts` couvre le flux OTP complet (envoi → vérification
  → session) sur une base réelle.

### E2E — `test/e2e/`

`Test.createTestingModule({ imports: [AppModule] })` + `bootstrapTestApp()`
(réutilise les **vraies** fonctions de `src/bootstrap/`) + supertest.

```ts
const res = await request(app.getHttpServer()).get('/v1/me').expect(401);
expect(res.body).toMatchObject({ status: 401, code: 'UNAUTHORIZED', instance: '/v1/me' });
```

- **Hermétiques** : `test/e2e/setup-env.ts` pose l'env minimal, `.env` est
  ignoré (`NODE_ENV=test`), Redis/Postgres jamais contactés (connexions lazy
  - `overrideProvider(TOKEN).useValue(fake)` sur les ports réseau).
- Ce qu'on vérifie : routing, versioning, guards, ValidationPipe, filter RFC
  7807, mappers — le **wiring**, pas la logique (déjà couverte en unit).
- Pas de logger Pino ni Helmet/CORS dans `bootstrapTestApp` (bruit / headers).
- Fakes partagés dans `test/support/fakes/` (`InMemoryDocumentRepository`,
  `FakeObjectStorage`, `FixedClock`) : utilisés par les unit **et** les e2e.
  Un fake implémente le port (le compilateur garantit qu'il suit le contrat).
- Le `SessionGuard` se remplace par `overrideGuard(SessionGuard)` (identité
  lue dans un en-tête de test) : better-auth est déjà couvert en intégration.

## Règles

- **TDD encouragé** sur les use-cases : test rouge → code minimal → refactor.
- Pas de `setTimeout` / `sleep` : `jest.useFakeTimers()` ou conditions explicites.
- Pas de dépendance à l'ordre ; pas d'état partagé entre tests (`beforeEach`).
- Fixtures via factories/fonctions (`aUser({ role: 'admin' })`), pas de gros objets inline dupliqués.
- Flaky = bug à corriger, pas une intermittence.
- `it.skip` / `xit` → commentaire avec ticket, sinon refusé en review.
- better-auth est ESM-only : les configs int/e2e transforment `.mjs` via
  `@swc/jest` — ne pas contourner par un mock global de la lib.

## Coverage gates

Définis dans `test/jest-unit.json` (`coverageThreshold.global`) : 30 % au
démarrage, 55 % à la mise en place de la CI, **60 %** depuis le module
`document`. Ce sont des
**planchers** : ils ne redescendent jamais et montent d'environ 5 points par
module livré. Le job `unit` de la CI échoue sous le plancher.
Exclus du calcul : modules Nest, DTOs, controllers (couverts en e2e),
schémas Drizzle, bootstrap, `shared/persistence|redis|security` (couverts en
int/e2e).

`pnpm test:cov` → rapport `coverage/` (html, lcov, junit).

## Outils

| Outil                                  | Usage                                              |
| -------------------------------------- | -------------------------------------------------- |
| `jest` 30 + `ts-jest` / `@swc/jest`    | runner ; swc pour les modules ESM (better-auth)    |
| `@nestjs/testing`                      | TestingModule + `overrideProvider` en e2e          |
| `supertest`                            | assertions HTTP                                    |
| `testcontainers` (+ postgresql, redis) | services réels en intégration (+ RustFS générique) |
| `jest-junit`                           | rapport CI (`coverage/junit-*.xml`)                |

## Anti-patterns

- ❌ Mocker Drizzle / ioredis dans un `.int.spec.ts`
- ❌ Test d'intégration qui appelle un fournisseur payant
- ❌ e2e qui lit le `.env` ou touche le Redis du compose
- ❌ Tester l'implémentation (`expect(repo.findById).toHaveBeenCalledWith(…)` seul) au lieu du résultat
- ❌ Test sans assertion ; assertion `toBeTruthy` là où `toEqual` est possible
- ❌ Baisser un seuil de coverage pour faire passer une PR
