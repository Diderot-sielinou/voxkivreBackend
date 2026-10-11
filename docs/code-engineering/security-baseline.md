# Security Baseline — voxlivre-api

## Principes

- **Denied by default** : un endpoint est protégé sauf décision explicite.
- **Defense in depth** : Railway proxy + Helmet + rate-limit + validation + guards + DB.
- **Least privilege** : token R2 scoped au bucket, rôle Postgres applicatif, container non-root.
- **Rien de sensible** dans le code, les logs, les réponses d'erreur.
- **Fail-open documenté** uniquement là où la disponibilité prime (rate-limit, ADR-0002) — avec garde-fou en base derrière.

## Secrets

- Zéro hardcode. Tout via `ConfigService<Env, true>` + schéma Zod ([config.md](config.md)).
- Prod : variables Railway. Dev : `.env` gitignored. `.env.example` = placeholders seulement.
- Secrets HMAC ≥ 32 chars (`BETTER_AUTH_SECRET`, `CURSOR_HMAC_SECRET`, secrets webhooks).
- Leak avéré : rotation immédiate → purge historique git → note dans un ADR.
- À venir : `gitleaks` en CI et en pre-commit.

## Validation des inputs

- **Tout** input externe validé **avant** typage : HTTP (DTO class-validator,
  `ValidationPipe` global strict), payload de job BullMQ (Zod), webhook
  fournisseur (Zod sur le JSON après vérification HMAC), fichier uploadé.
- Pas de `as any` / `as unknown as X` sur un input non validé.
- **PDF** : type MIME **et** magic bytes (`%PDF-`), taille max (env),
  nombre de pages max, parsing dans un worker avec timeout — un PDF est un
  format hostile (bombe de compression, JS embarqué, fonts malformées).
  L'API ne l'ouvre jamais dans le request lifecycle.
- Texte validé par l'utilisateur (RF-06) : longueur max en caractères
  (= quota), pas de HTML interprété. Le SSML est **généré** côté serveur,
  jamais accepté du client (injection SSML = coût TTS + contenu arbitraire).

## SQL

Drizzle paramètre tout. Jamais de `sql.raw` avec une valeur utilisateur ;
`sql\`…\`` template uniquement avec des identifiants constants.

## Authentification & sessions (ADR-0004)

- better-auth : OTP 6 chiffres, 5 min, 3 tentatives, stocké hashé, renvoi = rotation.
- Session 30 j rafraîchie à l'usage ; bearer **signé** (`requireSignature`) pour le mobile.
- `SessionGuard` sur **tout** controller métier ; `@CurrentUser()` pour l'identité.
- Rôle `user` | `admin` en colonne, `input: false` : jamais settable par le client.
- Le compte téléphone a un email technique `<digits>@phone.voxlivre.local` — jamais exposé (mapper `/v1/me`).
- Routes publiques : `/health/*`, `/api/auth/*` (better-auth gère son propre
  anti-abus), webhooks paiement (auth par HMAC).

## Rate limiting — deux étages

| Étage                | Où                                                    | Store                                                    | Panne Redis                     |
| -------------------- | ----------------------------------------------------- | -------------------------------------------------------- | ------------------------------- |
| Global (par IP)      | `ThrottlerGuard` `APP_GUARD`, tous les endpoints Nest | Redis dédié (`RATE_LIMIT_REDIS_CLIENT`, timeouts courts) | **fail-open** + warn (ADR-0002) |
| Auth (`/api/auth/*`) | better-auth, hors Nest                                | table `rate_limit` Postgres                              | indépendant de Redis            |

- OTP : 5 envois / 10 min / IP ; vérification : 15 / 10 min (`auth-rate-limit.rules.ts`).
- Endpoints coûteux (lancement de conversion, achat) : bucket dédié `@Throttle({ default: { … } })` **plus** un garde-fou en base (quota, compteur par compte) qui ne dépend pas de Redis (RNF-28).
- `TRUST_PROXY_HOPS=1` derrière Railway, sinon tout le monde partage l'IP du proxy.

## Webhooks paiement (Mobile Money — RNF-09)

Mis en œuvre pour Campay (ADR-0021) :

- Signature vérifiée **selon le fournisseur**, comparaison en temps constant. Campay signe par un JWT HS256 (clé webhook) qui ne couvre pas le corps : HMAC sur `rawBody` (`rawBody: true` dans `main.ts`) reste la règle pour un fournisseur qui signe le corps.
- La notification n'est qu'un **signal** : l'état (statut, montant, notre référence) est **relu chez le fournisseur** avec nos identifiants ; montant ≠ prix recopié → `amount_mismatch`, rien n'est accordé.
- Idempotence sans table d'événements : transitions conditionnelles (`WHERE status = …`) et référence de paiement unique côté `billing` → doublon = 200 sans effet.
- Horodatage (`exp`) vérifié quand le fournisseur le fournit (anti-replay).
- Route publique mais **par fournisseur** (`/v1/webhooks/<provider>`), jamais un endpoint générique ; corps jamais journalisé (numéro du client).

## Stockage objet & médias

- Bucket privé. Le client n'accède qu'à des **URL présignées** courtes (audio, VTT, upload PDF).
- Clés déterministes préfixées par `userId` — jamais dérivées d'un nom de fichier utilisateur.
- **Le PDF source est supprimé** après extraction du texte (CdC §8, positionnement juridique) ; job de nettoyage des orphelins.
- Le token R2 utilisé par l'API est scoped au bucket, pas au compte.

## CORS & headers

- CORS : allowlist `CORS_ALLOWED_ORIGINS` (vide en prod = aucune origine navigateur ; l'app mobile n'envoie pas d'`Origin`), fallback localhost hors prod. Headers exposés : `x-request-id`.
- Helmet : HSTS 1 an + preload, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`. CSP désactivée (API JSON pure ; Swagger UI incompatible) — à réactiver si l'API sert un jour du HTML.
- Swagger désactivé en prod par défaut (`SWAGGER_ENABLED`).

## Logs — pas de PII

Redaction Pino active (`shared/observability/logger.module.ts`) :
`authorization`, `cookie`, `set-cookie`, `*.password`, `*.token`,
`*.accessToken`, `*.refreshToken`, `*.secret`, `*.otp`, `*.code`,
`*.phone`, `*.email`. Sérialiseurs `req`/`res` réduits à
`method/url/id/statusCode` — jamais l'objet `req` entier.

`OTP_DELIVERY_MODE=log` (code OTP dans les logs) est **refusé en prod**
sauf override explicite.

## Erreurs — pas de leak

`ProblemDetailsFilter` : 500 → `detail: 'Internal server error'` ; les
`InfrastructureError` portent un message neutre, la `cause` reste en log.
Voir [error-handling.md](error-handling.md).

## Container & dépendances

- `node:22-alpine` épinglé (pas `latest`), `USER node`, `pnpm install --frozen-lockfile --ignore-scripts`, image finale sans devDeps ni sources.
- `pnpm audit --prod --audit-level=high` en CI (à venir) ; Dependabot hebdo (npm + docker).
- Pas de `latest` / `*` dans `package.json`.

## Modèle de menace (MVP)

| Menace                                 | Mitigation                                                                           |
| -------------------------------------- | ------------------------------------------------------------------------------------ |
| Abus du palier gratuit (RNF-28)        | OTP rate-limit en base, quota par compte, `Idempotency-Key`, compteur de conversions |
| Bombardement SMS/email via OTP         | 5 envois / 10 min / IP, `allowedAttempts`, coût surveillé par log                    |
| Replay / forge de webhook Mobile Money | Signature fournisseur + état relu chez lui + transitions conditionnelles (ADR-0021)  |
| PDF malveillant                        | Magic bytes, taille/pages max, parsing en worker isolé avec timeout                  |
| Vol de token                           | Bearer signé, session révocable, `authorization` jamais loggé                        |
| Piratage des audios générés            | Bucket privé, URL présignées courtes, clé par utilisateur                            |
| Redis down                             | Rate-limit fail-open + garde-fous en base ; BullMQ attend                            |
| Injection SSML                         | SSML généré serveur, texte utilisateur échappé                                       |

## Anti-patterns

- ❌ Controller métier sans `SessionGuard`
- ❌ `req.headers.authorization` parsé à la main
- ❌ Webhook qui crédite sans vérifier la signature **puis** l'idempotence
- ❌ Accepter du SSML ou une `voiceId` non validée contre le catalogue
- ❌ Logger `req`, un body de webhook, un OTP, un numéro de téléphone
- ❌ Désactiver Helmet / le throttler pour "faire passer" un test
- ❌ Garder le PDF "au cas où"
