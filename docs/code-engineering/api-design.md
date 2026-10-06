# API Design — voxlivre-api

Un seul client : l'app mobile Flutter, déployée sur les stores, que l'on
**ne peut pas mettre à jour de force**. Le contrat HTTP est donc versionné,
stable, économe en octets (data chère au Cameroun) et documenté par OpenAPI.

## Versioning — URI

```ts
// src/bootstrap/api.bootstrap.ts
app.enableVersioning({ type: VersioningType.URI, defaultVersion: API_DEFAULT_VERSION });

// controller métier
@Controller({ path: 'me', version: '1' })
export class MeController {}

// routes plateforme, hors versioning
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {}
```

- Bump **majeur** uniquement sur breaking change (type modifié, champ supprimé, sémantique changée).
- Ajout de champ / endpoint / valeur enum → pas un breaking change.
- Deux versions max en parallèle ; `Deprecation` + `Sunset` headers sur l'ancienne.
- Les routes better-auth vivent sous `/api/auth/*` (middleware Express monté
  hors Nest, ADR-0004) — versionnées par better-auth, pas par nous.

## DTOs & mappers

### Entrée

`class-validator` + `ValidationPipe` global (`whitelist`,
`forbidNonWhitelisted`, `transform`, `enableImplicitConversion: false`) :
un champ inconnu = 400, jamais ignoré. Chaque champ porte `@ApiProperty`.

```ts
export class StartConversionDto {
  @ApiProperty({ example: 'fr-FR-Standard-A' })
  @IsString()
  @Length(1, 64)
  voiceId!: string;

  @ApiProperty({ minimum: 0.5, maximum: 2 })
  @IsNumber()
  @Min(0.5)
  @Max(2)
  speakingRate!: number;
}
```

- **1 endpoint = 1 source de vérité de validation.** Le use-case reçoit des
  types déjà validés ; les invariants métier (quota, état du document) sont
  dans le domain, pas dupliqués dans le DTO.
- Validation Zod (`shared/config`, webhooks au format libre) quand
  class-validator est inadapté — jamais les deux sur le même input.

### Sortie

**Jamais une entité de domaine.** Un `XxxResponseDto` + une fonction mapper
pure (`toMeResponseDto(user)`). Pas de `ClassSerializerInterceptor` : les
mappers construisent des objets plats, le compilateur garantit le shape.

```ts
export function toMeResponseDto(user: User): MeResponseDto {
  return { id: user.id, email: hasTechnicalEmail(user) ? null : user.email /* … */ };
}
```

Dates en ISO 8601 UTC (`createdAt: user.createdAt.toISOString()`), IDs en
string, montants en entiers de sous-unité (XAF n'a pas de centimes, mais on
garde l'entier — pas de float monétaire).

## Pipes

| Pipe                                                | Usage                                        |
| --------------------------------------------------- | -------------------------------------------- |
| `ValidationPipe` (global)                           | DTOs body/query                              |
| `ParseUUIDPipe`, `ParseIntPipe`, `DefaultValuePipe` | Params et query primitifs                    |
| Pipe Zod custom                                     | Payloads hétérogènes (webhooks fournisseurs) |

## Guards & auth

```ts
@ApiBearerAuth()
@Controller({ path: 'me', version: '1' })
@UseGuards(SessionGuard)
export class MeController {
  @Get()
  me(@CurrentUser() user: AuthenticatedUser) {
    /* … */
  }
}
```

- `SessionGuard` (module `identity`, exporté) valide le bearer signé
  better-auth (ou le cookie Swagger) et pose `req.authUser`.
- **Tout controller métier** porte `@UseGuards(SessionGuard)` au niveau
  classe. Seules exceptions : `/health/*`, webhooks (auth par signature HMAC),
  et les routes better-auth.
- Rôle `admin` : guard de rôle empilé (`@UseGuards(SessionGuard, RolesGuard)`)
  quand le premier endpoint admin arrivera.
- L'identité passe au use-case **en argument** (`UserId.of(user.id)`), jamais
  par injection de `REQUEST`.

## Pagination — cursor signé

Tout listing (bibliothèque, historique de conversions, transactions) pagine
par cursor HMAC (`shared/kernel/pagination.ts`), jamais par OFFSET.

```ts
@Get()
list(
  @CurrentUser() user: AuthenticatedUser,
  @Query('cursor') cursor?: string,
  @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit = 20,
): Promise<CursorPageResponseDto<DocumentSummaryDto>>
```

```json
{ "items": [...], "nextCursor": "eyJz…|null" }
```

- Cursor **opaque** (`payload.signature`), rejeté avec `INVALID_CURSOR` (422) s'il est altéré.
- `limit` borné côté serveur (max 50 : payload mobile).
- Tri stable `(sortKey, id)` ; index composite correspondant.

## Idempotency

Les mutations **coûteuses ou financières** sont idempotentes :

- **Clé fonctionnelle** quand la ressource en a une : le lancement de
  conversion est unique par (document, voix, révision du texte) — rejouer la
  requête renvoie la conversion existante, sans nouveau débit (ADR-0010).
- **`Idempotency-Key`** (header déclaré dans CORS) sinon : achat de crédits,
  souscription.

- Clé validée par `IdempotencyKey.of(raw)` (UUID ou 8..128 chars `[A-Za-z0-9_-]`) → `INVALID_IDEMPOTENCY_KEY` sinon.
- Même clé + même body (`idempotencyHashOf`) → réponse rejouée ; même clé + body différent → 409.
- Stockage par le module concerné (table `idempotency_keys` ou Redis TTL 24 h), pas dans le kernel.
- Webhooks paiement : idempotence par identifiant d'événement fournisseur (RNF-09), signature HMAC sur `rawBody`.

## Upload & médias

- Import PDF (RF-01) : `multipart/form-data` avec limite dédiée par route
  **ou** URL présignée vers le stockage objet — jamais de base64 dans un JSON
  (plafond JSON global : 2 MB).
- Audio (MP3/OGG) et WebVTT : servis par le stockage objet via **URL
  présignée courte**, jamais streamés par l'API.
- Réponses de listing : payload minimal, pas de champ "au cas où".

## OpenAPI

Swagger sur `/docs` (`/docs/openapi.json`), activé hors production par
défaut, opt-in en prod (`SWAGGER_ENABLED`). Chaque endpoint : `@ApiTags`,
`@ApiOkResponse({ type })`, réponses d'erreur documentées
(`@ApiUnauthorizedResponse`…). Le mobile génère son client depuis la spec.

## Anti-patterns

- ❌ Entité de domaine renvoyée telle quelle
- ❌ Bump `v2` pour un ajout non-breaking
- ❌ Validation dupliquée DTO + use-case
- ❌ Logique métier dans un controller, un guard ou un interceptor
- ❌ Listing sans pagination, ou paginé par `offset`
- ❌ Mutation coûteuse non idempotente (ni clé fonctionnelle, ni `Idempotency-Key`)
- ❌ Fichier binaire dans un JSON
- ❌ Controller métier sans `@UseGuards(SessionGuard)`
