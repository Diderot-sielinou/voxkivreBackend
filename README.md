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
docker compose up -d        # Postgres :5433, Redis :6380, DbGate http://localhost:8081
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

- `GET /health` — liveness (healthcheck Railway)
- `GET /health/services` — readiness : Postgres / Redis (`200` ou `503`)
- `POST /api/auth/email-otp/send-verification-otp` · `POST /api/auth/sign-in/email-otp` — OTP email
- `POST /api/auth/phone-number/send-otp` · `POST /api/auth/phone-number/verify` — OTP téléphone
- `GET /v1/me` — profil courant (`Authorization: Bearer <set-auth-token>`)

En dev (`OTP_DELIVERY_MODE=log`), le code OTP est écrit dans les logs de l'API.

```bash
pnpm migrate:dev             # applique les migrations sur le compose local
```

## Workflow

Conventional Commits avec **scope obligatoire** ; hooks Git actifs
(pre-commit lint-staged + typecheck, commit-msg commitlint, pre-push tests).
