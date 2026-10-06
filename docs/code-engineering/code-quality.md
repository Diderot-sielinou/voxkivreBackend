# Qualité du code & approche technique — voxlivre-api

Ligne directrice : **simple, correct, observable** avant "scalable". Un solo
dev sur Railway ne peut pas maintenir ce qu'il ne comprend pas d'un coup
d'œil — mais aucun raccourci sur la qualité (cf. [AGENTS.md](../../AGENTS.md)).

| Domaine             | Choix & Outils                                                                                                               |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **Architecture**    | Hexagonale par module métier, monolithe modulaire ([ADR-0001](../adr/0001-hexagonal-architecture.md))                        |
| **Approche**        | TDD encouragé sur `domain/` + `application/` (test → code minimal → refactor)                                                |
| **API**             | REST only, versionnée par URI (`/v1`), OpenAPI via `@nestjs/swagger` (`/docs`) — **pas de GraphQL**                          |
| **Auth**            | better-auth, OTP email/téléphone, sessions bearer ([ADR-0004](../adr/0004-auth-better-auth-otp.md))                          |
| **Base de données** | PostgreSQL 16 + Drizzle ORM (migrations SQL versionnées)                                                                     |
| **Cache / queue**   | Redis 7 — BullMQ (pipeline asynchrone), rate-limit, cache                                                                    |
| **Stockage objet**  | S3-compatible (Cloudflare R2) via port `StoragePort` ; PDF supprimé après conversion                                         |
| **Qualité du code** | Prettier · ESLint (typescript-eslint strict, import-x boundaries, sonarjs, unicorn, security, promise) · lint-staged · Husky |
| **Revue de code**   | CodeRabbit + agents IA (contexte : `AGENTS.md` + ces docs)                                                                   |
| **Tests**           | Jest (unit / int Testcontainers / e2e supertest), coverage gate plancher                                                     |
| **Hébergement**     | Railway (Docker multi-stage, healthcheck `/health`, migrations en pré-déploiement)                                           |
| **Versioning**      | Conventional Commits avec scope obligatoire (commitlint) ; SemVer sur `package.json`                                         |
| **Convention**      | Clean Code, 1 fichier = 1 responsabilité, commentaires = "pourquoi", jamais "quoi"                                           |

## Ce qui est délibérément absent au MVP

- **OpenTelemetry / Prometheus** : logs structurés + slow-query logger suffisent
  (cf. [observability.md](observability.md)). À reconsidérer avec un vrai trafic.
- **GraphQL** : un seul client (Flutter), contrats REST + OpenAPI générés suffisent.
- **Microservices / broker** : BullMQ sur Redis couvre l'asynchrone ; un split
  ne se fait que sur ADR.
- **Multi-région / multi-AZ** : Railway, une région. Le code reste stateless
  (Redis pour tout état partagé) pour ne pas fermer la porte.

## Style

- Commentaires et docs en **français**, identifiants de code en **anglais**.
- Un commentaire explique une décision ou un invariant, pas ce que fait la ligne.
- Chaque `eslint-disable` porte un commentaire d'invariant sur la même ligne.
- Les littéraux "magiques" (chemins, noms de bucket, limites) vivent dans
  `shared/constants/` ou dans une constante nommée en tête de fichier.
