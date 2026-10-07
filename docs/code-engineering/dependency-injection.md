# Dependency Injection — voxlivre-api

## Constructor injection only

**Toujours** par le constructeur, jamais par property/setter injection.

```ts
// ✅ src/modules/identity/application/use-cases/get-current-user.use-case.ts
@Injectable()
export class GetCurrentUserUseCase {
  constructor(@Inject(USER_QUERY) private readonly users: UserQueryPort) {}
}

// ❌ property injection — dépendance cachée, non testable sans Nest
@Injectable()
export class GetCurrentUserUseCase {
  @Inject(USER_QUERY) users!: UserQueryPort;
}
```

Raisons : dépendances visibles au premier coup d'œil, champs `readonly`,
`new GetCurrentUserUseCase(fakePort)` direct dans les tests unitaires.

## Ports = interface + token Symbol

Chaque dépendance externe d'un use-case est un **port** (`domain/ports/`)
injecté via un **token `Symbol`**. L'adapter est branché dans le module Nest.

```ts
// domain/ports/user-query.port.ts
export const USER_QUERY = Symbol('UserQuery');
export interface UserQueryPort {
  findById(id: UserId): Promise<User | null>;
}

// infrastructure/persistence/user.drizzle-query.ts
@Injectable()
export class DrizzleUserQuery implements UserQueryPort {
  /* … */
}

// identity.module.ts
@Module({
  providers: [{ provide: USER_QUERY, useClass: DrizzleUserQuery }, GetCurrentUserUseCase],
})
export class IdentityModule {}
```

Pourquoi `Symbol` et pas `string` : pas de collision, autocomplete, refactor
sûr. Pourquoi un port même pour un seul adapter : changer de fournisseur
(TTS, OCR, paiement, stockage) = nouvel adapter, zéro changement dans
`application/` (SRS RNF-17).

### Ports transverses du kernel

`shared/` expose déjà : `CLOCK` (`ClockPort`), `UNIT_OF_WORK`
(`UnitOfWorkPort`), `DRIZZLE_CLIENT`, `REDIS_CLIENT`. Les utilitaires purs du
kernel (`Result`, `Brand`, `IdempotencyKey`, cursor codec) s'importent
directement — pas de port pour ce qui n'a pas de variante d'implémentation.

## SOLID dans l'archi hex

| Principe                  | Application concrète Voxlivre                                                                             |
| ------------------------- | --------------------------------------------------------------------------------------------------------- |
| **S**ingle Responsibility | 1 fichier = 1 use-case. "Valider le texte + débiter le quota + lancer la TTS" = 3 use-cases orchestrés.   |
| **O**pen/Closed           | Google TTS → Amazon Polly (ADR-0013) : nouvel adapter de `TtsPort`, use-cases intacts.                    |
| **L**iskov Substitution   | Un `OtpSenderPort` `log` et un `notification` ont la même sémantique (envoi = succès ou erreur typée).    |
| **I**nterface Segregation | `UserQueryPort` (lecture) séparé d'un futur `UserRepositoryPort` ; `TtsPort` ≠ `VoiceCatalogPort`.        |
| **D**ependency Inversion  | Use-case → port (domain) ← adapter (infrastructure). Enforcé par ESLint (`import-x/no-restricted-paths`). |

## Service locator — anti-pattern

Pas de `ModuleRef.get()` dans le code métier : dépendances invisibles, tests
impossibles sans container, couplage framework. Toléré uniquement dans le
bootstrap (`main.ts`, `src/bootstrap/*.bootstrap.ts` font `app.get(...)`
pour câbler Express — c'est leur rôle).

## Scopes Nest

| Scope                 | Cycle de vie                | Voxlivre                                                                        |
| --------------------- | --------------------------- | ------------------------------------------------------------------------------- |
| `DEFAULT` (singleton) | 1 instance pour toute l'app | **Toujours** : use-cases, adapters, guards, processors.                         |
| `REQUEST`             | 1 instance par requête      | Interdit sauf ADR. Le request-id vient de `requestContext` (AsyncLocalStorage). |
| `TRANSIENT`           | 1 instance par injection    | Jamais rencontré. Préférer une factory.                                         |

Besoin de l'utilisateur courant dans un use-case ? Il vient **en argument**
(`execute(UserId.of(user.id))`) via `@CurrentUser()` dans le controller —
jamais en injectant `REQUEST`.

## Modules : partage, exports, globaux

- Tout provider consommé ailleurs est dans `exports:` de son module d'origine
  (`IdentityModule` exporte `SessionGuard` pour les modules métier).
- Modules techniques transverses `@Global()` : `AppConfigModule`, `ClockModule`,
  `DrizzleModule`, `RedisModule`, `AppLoggerModule`. Tout le reste s'importe
  explicitement.
- Un même `useClass` déclaré dans 2 modules = 2 instances qui divergent.
  Déclarer une fois, exporter, importer.
- Un port n'est câblé que dans **son** module ; un autre module qui a besoin
  de la donnée passe par un port de requête (`XxxQueryPort`) ou un domain
  event, jamais par l'adapter de l'autre module.

## DI en test

`new` direct pour domain + application (aucun boot Nest) :

```ts
const users: UserQueryPort = { findById: () => Promise.resolve(null) };
const sut = new GetCurrentUserUseCase(users);
```

`Test.createTestingModule({ imports: [AppModule] })` réservé aux e2e, avec
`overrideProvider(TOKEN).useValue(fake)` sur les ports réseau.

## Anti-patterns récap

- ❌ `@Inject(PORT) port!: Port` en property
- ❌ `ModuleRef.get(...)` hors bootstrap
- ❌ `Scope.REQUEST` "par confort"
- ❌ `@Inject('SomeString')`
- ❌ Use-case qui importe `DRIZZLE_CLIENT` directement (utiliser un port de repository)
- ❌ Adapter d'un module injecté dans un autre module (passer par un port ou un event)
