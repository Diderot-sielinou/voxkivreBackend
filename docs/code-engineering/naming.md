# Naming — voxlivre-api

Convention NestJS (kebab-case + suffixe sémantique). Les exemples sont tirés
des modules `health` / `identity` ou des modules métier à venir (`document`,
`conversion`, `library`, `billing`, `payment`).

## Fichiers

| Type                  | Pattern                                              | Exemple                                                                |
| --------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------- |
| Entité                | `<name>.entity.ts`                                   | `user.entity.ts`, `conversion.entity.ts`                               |
| Value object          | `<name>.vo.ts`                                       | `phone-number.vo.ts`, `char-count.vo.ts`                               |
| Port (interface)      | `<name>.port.ts`                                     | `user-query.port.ts`, `otp-sender.port.ts`                             |
| Use-case              | `<verb-noun>.use-case.ts`                            | `get-current-user.use-case.ts`                                         |
| Application service   | `<name>.service.ts`                                  | `conversion-pipeline.service.ts`                                       |
| Domain event          | `<noun-past-verb>.event.ts`                          | `conversion-completed.event.ts`                                        |
| Domain error          | `<name>.error.ts` + `error-codes.ts`                 | `user-not-found.error.ts`                                              |
| Repository / query DB | `<name>.drizzle-query.ts` / `.drizzle-repository.ts` | `user.drizzle-query.ts`                                                |
| Autre adapter         | `<impl>-<port>.adapter.ts`                           | `logging-otp-sender.adapter.ts`, `tcp-service-connectivity.adapter.ts` |
| Schéma Drizzle        | `<name>.schema.ts` (glob drizzle-kit)                | `auth.schema.ts`                                                       |
| Processor BullMQ      | `<job>.processor.ts`                                 | `synthesize-audio.processor.ts`                                        |
| Controller            | `<resource>.controller.ts`                           | `me.controller.ts`, `health.controller.ts`                             |
| Guard / décorateur    | `<name>.guard.ts` / `<name>.decorator.ts`            | `session.guard.ts`, `current-user.decorator.ts`                        |
| DTO                   | `<name>.dto.ts`                                      | `me-response.dto.ts`                                                   |
| Mapper                | `<name>.mapper.ts`                                   | `me.mapper.ts`                                                         |
| Module Nest           | `<domain>.module.ts`                                 | `identity.module.ts`                                                   |
| Bootstrap             | `<concern>.bootstrap.ts`                             | `security.bootstrap.ts`                                                |
| Test unit             | mirror + `.spec.ts`                                  | `phone-number.vo.spec.ts`                                              |
| Test intégration      | mirror + `.int.spec.ts`                              | `better-auth.int.spec.ts`                                              |
| Test e2e              | `test/e2e/<domain>.e2e-spec.ts`                      | `identity.e2e-spec.ts`                                                 |

## Ports : interface + token Symbol

```ts
// domain/ports/user-query.port.ts
export const USER_QUERY = Symbol('UserQuery');
export interface UserQueryPort {
  findById(id: UserId): Promise<User | null>;
}

// application/use-cases/get-current-user.use-case.ts
constructor(@Inject(USER_QUERY) private readonly users: UserQueryPort) {}
```

Le token porte le nom du port **sans** suffixe `Port` ; l'interface porte le
suffixe `Port`. Jamais de token `string`.

## Classes & identifiants

- `PascalCase` : classes, types, interfaces, enums.
- `camelCase` : variables, fonctions, méthodes.
- `UPPER_SNAKE_CASE` : constantes de module (`OTP_LENGTH_DEFAULT`, `MAX_PDF_BYTES`) et tokens DI.
- Booléens : préfixe `is`, `has`, `can`, `should` (`isProduction`, `hasTechnicalEmail`).
- Pas de suffixe `Async` — le `Promise<…>` du type de retour parle.
- IDs typés via `Brand` (`UserId`, `DocumentId`) + factory `XxxId.of(raw)`.

## Use-cases

Classe `<Verbe><Nom>UseCase`, méthode unique `execute(input)` qui renvoie
`Result<T, DomainError>`.

- ✅ `GetCurrentUserUseCase`, `StartConversionUseCase`, `DebitQuotaUseCase`
- ❌ `ConversionService` (fourre-tout), `ConversionManager`, `handleConversion`

## DTOs

Suffixe `Dto` **conservé** dans le nom de classe (contrairement à cinaf) —
il rend l'origine HTTP visible dans les mappers et Swagger. Direction par
préfixe/suffixe : `CreateXxxDto` / `UpdateXxxDto` (entrée), `XxxResponseDto`
(sortie). Champs décorés `@ApiProperty` + `class-validator` (entrée).

Mappers = **fonctions pures** exportées : `toMeResponseDto(user)`,
`toServicesHealthResponseDto(report)`. Pas de classe mapper, pas de
`class-transformer` implicite.

## Erreurs de domaine

- Classe `<Name>Error` étendant `DomainError` (`shared/kernel`).
- Code dans le `error-codes.ts` du module : `<MODULE>_ERROR_CODES`
  (`IDENTITY_ERROR_CODES.USER_NOT_FOUND`).
- Le **code** suit la convention de routing HTTP (cf.
  [error-handling.md](error-handling.md)) : `*_NOT_FOUND`, `*_CONFLICT`,
  `INVALID_*`, `INFRASTRUCTURE_*`… Le nom de classe suit le code
  (`QuotaExceededError` ↔ `QUOTA_EXCEEDED`).

## Jobs BullMQ

- Nom de queue : `<domain>` en kebab (`conversion`, `notification`, `payment`).
- Nom de job : verbe métier en kebab (`extract-text`, `synthesize-audio`).
- `jobId` déterministe = clé d'idempotence (cf. [jobs-and-pipeline.md](jobs-and-pipeline.md)).

## Tests

```ts
describe('GetCurrentUserUseCase', () => {
  it('returns USER_NOT_FOUND when missing', async () => {
    /* … */
  });
});
```

- `describe` = unité testée (classe, use-case, fonction).
- `it` = comportement en langage métier, mentionne le **code** d'erreur attendu.
- Matchers précis (`toEqual`, `toMatchObject`) plutôt que `toBeTruthy`.

## Commits (rappel)

`<type>(<scope>): <sujet impératif, lowercase, sans point>` — scope = module
hexagonal touché, ou `shared`, `deps`, `ci`, `docs`, `tooling`.

- `feat(conversion): enqueue synthesize-audio job after text validation`
- `fix(identity): mask technical phone email in /v1/me`
- `perf(library): add composite index on (user_id, updated_at)`
