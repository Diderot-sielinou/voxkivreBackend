# Error Handling — voxlivre-api

## Principes

1. **Pas de `catch` silencieux.** Si tu catch : tu logges, tu wraps ou tu rethrow.
2. **Pas de leak en prod** : jamais de stack, de SQL ni de message fournisseur dans la réponse HTTP.
3. **Erreurs métier typées** : `DomainError` avec `code` stable. Le domain ne throw jamais un `Error` brut.
4. **Use-cases → `Result<T, DomainError>`**, pas de `throw` métier dans `domain/` ni `application/`.
5. **Frontière unique** : `ProblemDetailsFilter` (global) mappe tout en **RFC 7807**.
6. **Pas de `HttpException` Nest** hors `interface/` : `NotFoundException` dans un use-case = couplage HTTP ↔ métier, interdit.
7. **503 ≠ 500** : un tiers indisponible (TTS, Redis, Mobile Money) est une `InfrastructureError` → 503, jamais 500 (RNF-11 : le mobile sait qu'un retry est légitime).

## Hiérarchie

```
src/shared/kernel/
  domain-error.ts   # DomainError (abstract) : code, details, cause
  error-codes.ts    # ERROR_CODES transverses (VALIDATION_FAILED, NOT_FOUND, INFRASTRUCTURE_ERROR…)
  errors.ts         # sous-classes concrètes : ValidationError, NotFoundError, UnauthorizedError,
                    # ForbiddenError, RateLimitExceededError, InfrastructureError, InvalidCursorError…
  result.ts         # Result<T, E>

src/modules/<domain>/domain/errors/
  error-codes.ts               # <MODULE>_ERROR_CODES (ex. IDENTITY_ERROR_CODES)
  user-not-found.error.ts      # une classe par erreur
```

```ts
// modules/identity/domain/errors/user-not-found.error.ts
export class UserNotFoundError extends DomainError {
  readonly code = IDENTITY_ERROR_CODES.USER_NOT_FOUND;
  constructor(userId: string) {
    super(`User ${userId} not found`, { details: { userId } });
  }
}
```

`details` = payload structuré pour le client (quota restant, longueur reçue,
identifiant) — **jamais** de donnée sensible.

## `Result` dans les use-cases

```ts
async execute(userId: UserId): Promise<Result<User, UserNotFoundError>> {
  const user = await this.users.findById(userId);
  return user === null ? Result.err(new UserNotFoundError(userId)) : Result.ok(user);
}
```

Le `throw` est réservé aux erreurs **inattendues** (bug) et aux adapters
d'infrastructure qui wrapent une panne en `InfrastructureError`.

## Frontière HTTP : le controller throw le `Result.error`

```ts
const result = await this.getCurrentUser.execute(UserId.of(user.id));
if (result.isErr()) throw result.error; // le filter global répond
return toMeResponseDto(result.value);
```

Un guard peut aussi throw une `DomainError` (`SessionGuard` → `UnauthorizedError`).

## Convention `code → HTTP` (`shared/http/error-status.ts`)

| Code                        | HTTP |
| --------------------------- | ---- |
| `NOT_FOUND`, `*_NOT_FOUND`  | 404  |
| `CONFLICT`, `*_CONFLICT`    | 409  |
| `*_PAYLOAD_TOO_LARGE`       | 413  |
| `INVALID_*`, `VALIDATION_*` | 422  |
| `UNAUTHORIZED*`             | 401  |
| `FORBIDDEN*`                | 403  |
| `RATE_LIMIT*`               | 429  |
| `INFRASTRUCTURE_*`          | 503  |
| défaut                      | 500  |

Les codes qui ne peuvent pas suivre la convention (ex. `QUOTA_EXCEEDED` → 402
Payment Required) vont dans la table `EXPLICIT_STATUS_BY_CODE` du même
fichier — une entrée = un contrat client, pas un `if` de plus.

Pourquoi 422 et pas 400 : body syntaxiquement valide mais sémantiquement
faux → 422. Le 400 reste au `ValidationPipe` (champ inconnu, type faux),
avant qu'une `DomainError` n'existe.

## Réponse RFC 7807

```json
{
  "type": "about:blank",
  "title": "Not Found",
  "status": 404,
  "detail": "User ghost not found",
  "instance": "/v1/me",
  "code": "USER_NOT_FOUND",
  "details": { "userId": "ghost" },
  "requestId": "3f0b…"
}
```

`content-type: application/problem+json`. Le mobile branche ses messages
(i18n) sur `code`, jamais sur `detail`. `requestId` permet au support de
retrouver la ligne de log.

Le filter gère aussi : `HttpException` Nest (status préservé, body
normalisé), corps trop volumineux (`raw-body` → 413), et tout le reste → 500
avec `detail: 'Internal server error'`. Il logge `error` (≥ 500, avec `err`)
ou `warn` (4xx, code seulement).

## Adapters : wrapper, ne jamais avaler

```ts
try {
  return await this.tts.synthesize(ssml, voice);
} catch (err) {
  this.logger.error({ err, documentId }, 'TTS synthesis failed');
  throw new InfrastructureError('TTS provider unavailable', { cause: err });
}
```

Le message reste **neutre** (pas de payload fournisseur), la `cause` reste
côté serveur pour les logs.

## Tests

- Chaque branche d'erreur d'un use-case = un test.
- Tester le **code** (stable), pas le message : `expect(r.error.code).toBe(IDENTITY_ERROR_CODES.USER_NOT_FOUND)`.
- e2e : `expect(res.body).toMatchObject({ status: 401, code: 'UNAUTHORIZED' })` + content-type `problem+json`.

## Anti-patterns

- ❌ `catch (e) {}` ou `catch (e) { console.log(e) }`
- ❌ `throw new Error('…')` dans `domain/` / `application/`
- ❌ `throw new NotFoundException()` dans un use-case
- ❌ Renvoyer `err.message` d'un SDK fournisseur au client
- ❌ Mapper sur `err.message` (volatile, i18n) au lieu de `err.code`
- ❌ Panne Redis/TTS → 500 (c'est un 503 `INFRASTRUCTURE_*`)
- ❌ Ajouter un `if` dans `statusFromCode` pour un cas unique (utiliser `EXPLICIT_STATUS_BY_CODE`)
