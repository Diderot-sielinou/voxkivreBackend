# voxlivre-api

Backend de **Voxlivre** — application mobile de lecture synchronisée
audio-texte (Read-Along) à partir de documents PDF. Marché cible : Cameroun
francophone. NestJS 11 · TypeScript 5.7 · Node 22 · PostgreSQL · Redis ·
BullMQ · stockage objet S3-compatible.

## Architecture

Architecture hexagonale stricte ([ADR-0001](docs/adr/0001-hexagonal-architecture.md)) :

```
src/
├── bootstrap/          # configureX(app) : express, security, cors, api, swagger
├── modules/<domain>/
│   ├── domain/         # entités, ports, erreurs métier — TS pur
│   ├── application/    # use-cases (1 fichier = 1 use-case)
│   ├── infrastructure/ # adapters DB / cache / queue / TTS / OCR / paiement
│   └── interface/      # controllers HTTP, DTOs, mappers
└── shared/             # config (Zod), kernel, http (RFC 7807), observability, persistence, redis, security
```

Règles non-négociables : [AGENTS.md](AGENTS.md). Décisions : [docs/adr/](docs/adr/).

## Pré-requis

| Outil  | Version                            |
| ------ | ---------------------------------- |
| Node   | `>= 22.22.1 < 23` (`.nvmrc`)       |
| pnpm   | 11.x (`corepack enable`)           |
| Docker | pour la stack locale et `test:int` |

## Démarrer

```bash
cp .env.example .env
docker compose up -d        # Postgres :5433, Redis :6380, RustFS (S3) :9002, DbGate http://localhost:8081
pnpm install
pnpm start:dev              # http://localhost:8080/docs
```

## Qualité

```bash
pnpm lint:check             # ESLint strict + boundaries hexagonales
pnpm typecheck
pnpm test                   # unit (domain + application + kernel)
pnpm test:int               # intégration (Testcontainers)
pnpm test:e2e               # end-to-end (supertest, ports fakés)
pnpm test:cov
```

## Base de données (Drizzle)

```bash
pnpm drizzle:generate       # migration depuis les *.schema.ts des modules
pnpm drizzle:migrate
pnpm drizzle:check
```

## Endpoints

- `GET /health` — liveness (healthcheck de l'hébergeur : Caddy/EC2, ALB/ECS)
- `GET /health/services` — readiness : Postgres / Redis (`200` ou `503`)
- `POST /api/auth/email-otp/send-verification-otp` · `POST /api/auth/sign-in/email-otp` — OTP email
- `POST /api/auth/phone-number/send-otp` · `POST /api/auth/phone-number/verify` — OTP téléphone (mobiles camerounais `+2376…` ; 429 `OTP_RATE_LIMITED` au-delà de 3 codes/heure ou du plafond quotidien, ADR-0017)
- `GET /v1/me` — profil courant (`Authorization: Bearer <set-auth-token>`)
- `POST /v1/documents` — déclare un import de PDF, renvoie une URL d'upload signée (ADR-0007)
- `POST /v1/documents/:id/upload-confirmation` — vérifie le fichier reçu (taille, signature `%PDF-`)
- `GET /v1/documents/:id` · `GET /v1/documents?cursor=&limit=` — consultation, liste paginée des imports
- `GET /v1/documents/:id/pages?cursor=&limit=` · `PUT /v1/documents/:id/pages/:pageNumber` — texte extrait, correction (RF-06)
- `GET /v1/voices` — voix proposées et leur gamme `standard` / `natural` (RF-21)
- `GET /v1/billing/offers` — pass et packs de crédits en FCFA, poids des voix (RF-23, ADR-0019)
- `GET /v1/billing/account` — reste du palier gratuit, pass en cours, solde de crédits (RF-24)
- `GET /v1/billing/wallet/entries?cursor=&limit=` — historique des recharges, consommations et remboursements
- `POST /v1/documents/:id/conversions` — lance la synthèse vocale (`{ "voiceId": "fr-f2" }`), réserve les unités (ADR-0010, ADR-0019)
- `GET /v1/conversions/:id` — statut et progression (`segmentsDone` / `segmentCount`, `partsReady` / `partCount`)
- `GET /v1/conversions/:id/manifest` — parties MP3 + WebVTT avec URL de téléchargement signées (ADR-0011), dès la première partie
- `GET /v1/library?cursor=&limit=` — bibliothèque : un livre par document, conversion retenue, position et statut (`processing`, `not_converted`, `ready`, `in_progress`, `finished`, `failed`) (RF-17, ADR-0015)
- `PUT /v1/conversions/:id/position` · `GET /v1/conversions/:id/position` — position de lecture multi-appareils, « le plus récent gagne » (`recordedAt`) (RF-19/20, ADR-0015)
- `DELETE /v1/documents/:id` — supprime un livre (texte, conversions, position) ; fichiers effacés en arrière-plan par outbox (RF-25, ADR-0016)

Après la confirmation, un worker BullMQ (même processus que l'API, ADR-0009)
extrait le texte et supprime le PDF : `status` passe `uploaded` → `extracting`
→ `text_ready` (ou `extraction_failed` + `extractionError`).

Le lancement d'une conversion réserve `charCount` × poids de la voix (×1
standard, ×4 naturelle) sur le palier gratuit (voix standard seulement), puis
le pass, puis les crédits (402 `QUOTA_EXCEEDED` s'ils ne suffisent pas,
ADR-0019), puis deux files BullMQ
prennent le relais : `conversion-prepare` découpe le texte en segments SSML,
`conversion-synthesis` les synthétise (4 en parallèle, premiers segments en
priorité), puis `conversion-assembly` met bout à bout les segments de
chaque partie (~10 min, la première ~2 min pour l'aperçu) en un MP3 et un
WebVTT au mot. `status` : `queued` → `preparing` → `synthesizing` →
`synthesized` → `ready` (ou `failed` + `failureReason`, quota non consommé
remboursé). Avec
`TTS_PROVIDER=fake` (défaut), le moteur factice produit du silence : tout le
pipeline tourne en local sans rien payer. `TTS_PROVIDER=polly` (avec
`AWS_REGION` et un profil AWS) utilise Amazon Polly (ADR-0013).

Import d'un PDF en local (le fichier va directement dans RustFS, pas dans l'API) :

```bash
# 1. déclarer l'import → récupérer upload.url et upload.headers
curl -s -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d "{\"title\":\"Mon cours\",\"sizeBytes\":$(stat -c %s cours.pdf),\"rightsAttested\":true}" \
  localhost:8080/v1/documents
# 2. envoyer le fichier à l'URL signée (mêmes en-têtes)
curl -X PUT -H 'content-type: application/pdf' --data-binary @cours.pdf "<upload.url>"
# 3. confirmer
curl -X POST -H "Authorization: Bearer $TOKEN" localhost:8080/v1/documents/<id>/upload-confirmation
```

Console RustFS : http://localhost:9003/rustfs/console/index.html (identifiants : `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` du `.env.example`).

En dev (`OTP_DELIVERY_MODE=log`), le code OTP est écrit dans les logs de l'API. En `notification`, il part par SMS (API Orange Cameroun) ou par e-mail (Amazon SES), cf. ADR-0017.

```bash
pnpm migrate:dev             # applique les migrations sur le compose local
```

## Workflow

Conventional Commits avec **scope obligatoire** ; hooks Git actifs
(pre-commit lint-staged + typecheck, commit-msg commitlint, pre-push tests).
