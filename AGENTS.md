# AGENTS.md — Règles non-négociables pour voxlivre-api

Chargé en contexte par les agents IA (Claude, CodeRabbit, Copilot…) et lu
par les humains. Court et directif. Le détail va dans
[docs/code-engineering/](docs/code-engineering/), les justifications dans
[docs/adr/](docs/adr/).

## Objectif projet

Backend de **Voxlivre** — app mobile (Flutter) de lecture synchronisée
audio-texte (Read-Along) à partir de PDF. Marché cible : Cameroun
francophone (connexion instable, data chère, Mobile Money). Pipeline
asynchrone PDF → texte → SSML → TTS (timepoints) → WebVTT, quota en
caractères, abonnement + crédits. Spécifications de référence :
`../doc-projet/` (Cahier des charges v3, SRS v2, SDD v1).

Solo dev, hébergement AWS par phases (EC2 puis Fargate en vitrine, [ADR-0012](docs/adr/0012-aws-hosting-ec2-then-fargate.md)), budget serré : **simple, correct, observable**
avant "scalable". Mais pas de raccourci sur la qualité — la base est calquée
sur cinaf-engine (Netflix-grade) et adaptée, pas dégradée.

## Stack imposée

- TypeScript 5.7+ `strict: true` (`noImplicitAny` off toléré)
- NestJS 11 (modular monolith, **pas microservices**), REST only (pas de GraphQL)
- Node 22 LTS, pnpm 11 via Corepack
- PostgreSQL 16 (Drizzle) + Redis 7 (BullMQ, rate-limit, cache) + stockage objet S3-compatible (S3 natif sur AWS, RustFS en local)
- Infrastructure AWS décrite en Terraform (`infra/`), synthèse vocale Amazon Polly, e-mails OTP Amazon SES ([architecture](docs/architecture/aws.md))
- Archi hexagonale (cf. [ADR-0001](docs/adr/0001-hexagonal-architecture.md))
- Vue d'ensemble des choix outils : [code-quality.md](docs/code-engineering/code-quality.md)

## Règles non-négociables

### Architecture hexagonale ([hexagonal-guide.md](docs/code-engineering/hexagonal-guide.md), [dependency-injection.md](docs/code-engineering/dependency-injection.md))

```
src/modules/<domain>/
  domain/         # entities, value objects, ports (interfaces), domain errors — TS PUR
  application/    # use-cases (1 fichier = 1 use-case), application services
  infrastructure/ # adapters DB/cache/queue/API externes (TTS, OCR, paiement, stockage)
  interface/      # HTTP controllers, DTOs, mappers
```

- `domain/` n'importe **jamais** `infrastructure/`, `@nestjs/*`, Drizzle, ioredis,
  BullMQ, better-auth ni un SDK fournisseur — **enforcé par ESLint**, le build casse.
- `application/` dépend de **ports** (interfaces + token `Symbol`), pas d'implémentations.
- Mappers DTO ↔ Domain explicites ; jamais d'entité de domaine exposée en HTTP.
- Use-cases renvoient `Result<T, DomainError>` — pas de `throw` d'erreur métier.
- Changer de fournisseur (TTS, OCR, paiement, stockage) = un nouvel adapter, zéro
  changement dans `domain/` / `application/` (SRS RNF-17).

### Performance & DB ([performance-rules.md](docs/code-engineering/performance-rules.md), [migrations.md](docs/code-engineering/migrations.md), [jobs-and-pipeline.md](docs/code-engineering/jobs-and-pipeline.md))

- **Jamais** `SELECT *` ; pagination par **cursor signé** (kernel), jamais OFFSET.
- Pas de N+1 ; index sur les colonnes filtrées/triées.
- Tout travail > 200 ms (extraction PDF, OCR, TTS) → **job BullMQ**, jamais dans le request lifecycle.
- Chaque étape du pipeline est **idempotente** (RNF-12) : un retry ne refacture ni TTS ni quota.

### Sécurité ([security-baseline.md](docs/code-engineering/security-baseline.md), [config.md](docs/code-engineering/config.md))

- **Aucun** hardcode (secrets, URLs, IDs) — tout via `ConfigService<Env, true>` + schéma Zod.
- Tout input externe validé (DTO class-validator ou Zod) **avant** typage.
- **Aucun** PII / secret dans les logs : redaction Pino active (`otp`, `phone`, `email`, tokens).
- Webhooks paiement : signature vérifiée selon le fournisseur, puis **état relu chez lui**
  avant d'accorder quoi que ce soit ; transitions conditionnelles (RNF-09, [ADR-0021](docs/adr/0021-payment-campay-mobile-money.md)).
- CORS strict, Helmet, rate-limit global (**fail-open** si Redis down, cf. ADR-0002).
- Le PDF source est **supprimé** après conversion (positionnement juridique, CdC §8).

### Types & DI ([naming.md](docs/code-engineering/naming.md), [dependency-injection.md](docs/code-engineering/dependency-injection.md))

- Pas d'`any`, pas de `as unknown as X` sans commentaire d'invariant.
- Ports = `interface` + token `Symbol` ; **constructor injection only**.
- Scope par défaut `DEFAULT` (singleton) ; `REQUEST` seulement si justifié.
- 1 fichier = 1 responsabilité. Use-case qui fait 3 choses → 3 use-cases.

### Lifecycle ([lifecycle.md](docs/code-engineering/lifecycle.md))

- `enableShutdownHooks()` actif ; ressources fermées en `OnApplicationShutdown` (pool PG, Redis, workers).
- Pas de gros travail au boot.
- Connexions **lazy** : l'app boote sans DB/Redis (e2e, dev dégradé).

### Erreurs ([error-handling.md](docs/code-engineering/error-handling.md), [api-design.md](docs/code-engineering/api-design.md))

- `DomainError` avec `code` stable → filter global **Problem Details (RFC 7807)**.
- Convention `code → HTTP` : `*_NOT_FOUND`→404, `*_CONFLICT`→409, `INVALID_*`→422,
  `INFRASTRUCTURE_*`→503 (jamais 500 pour un tiers indisponible — RNF-11).
- Pas de `catch` silencieux ; pas de stack/SQL en prod.

### Observabilité (MVP minimal, sans OTel — [observability.md](docs/code-engineering/observability.md))

- Jamais `console.log` — `Logger` Nest (Pino).
- `x-request-id` propagé via AsyncLocalStorage, renvoyé au mobile.
- Slow-query logger (> 100 ms warn, > 500 ms error).

### Tests ([testing-strategy.md](docs/code-engineering/testing-strategy.md))

- `domain/` + `application/` : unit, isolation totale, ~100 %.
- `infrastructure/` : Testcontainers (Postgres/Redis réels) — `*.int.spec.ts`.
- `interface/` : e2e supertest sur l'app complète (ports overridés par des fakes).
- Coverage gate = **plancher**, il monte à chaque module.
- Les e2e sont **hermétiques** : `.env` ignoré en `NODE_ENV=test`.

## Choses à NE PAS faire

- Commits sans scope (`feat:` au lieu de `feat(conversion):`)
- `--no-verify` sans raison documentée
- Désactiver une règle ESLint sans commentaire d'invariant
- Logique métier dans un controller ou un processor BullMQ (extraire en use-case)
- Importer NestJS / Drizzle / un SDK dans `domain/` ou `application/`
- Utiliser `maxRetriesPerRequest: null` (réglage BullMQ) sur un client Redis du chemin de requête
- Stocker un secret en clair ; committer `.env`
- Ajouter une variable d'env "au cas où" dans `env.schema.ts`

## Workflow ([workflow.md](docs/code-engineering/workflow.md))

- **Conventional Commits** avec **scope obligatoire** (commitlint), header ≤ 100 chars.
- Hooks : pre-commit (lint-staged + typecheck), commit-msg (commitlint), pre-push (tests).
- Décisions d'architecture → ADR dans `docs/adr/` **avant** le code.
- Scope minimal : un commit / une PR = un sujet.

## Pour les agents IA

- Lis ce fichier en entier avant tout edit non trivial.
- En cas de doute sur la conformité d'un changement, ouvre la doc correspondante dans
  [docs/code-engineering/](docs/code-engineering/README.md) plutôt que de deviner.
- Les ADRs sont la source de vérité des "pourquoi". Une décision te semble étrange ? Lis l'ADR.
- N'invente pas de pattern non documenté ; propose un ADR.
- Le module `health` est le **gabarit** : reproduis sa structure pour tout nouveau module.
