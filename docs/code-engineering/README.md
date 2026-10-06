# Engineering docs — voxlivre-api

Référence technique du backend Voxlivre. Lis [AGENTS.md](../../AGENTS.md) en
premier pour la vue d'ensemble des règles non-négociables ; chaque section
d'AGENTS.md pointe vers le document détaillé correspondant ici.

Base calquée sur cinaf-engine (Netflix-grade) et **adaptée** au contexte
Voxlivre : solo dev, Railway, budget serré, client mobile Flutter sur réseau
instable, pipeline asynchrone PDF → TTS. Adaptée, pas dégradée.

## Index

| Document                                           | Contenu                                                                         |
| -------------------------------------------------- | ------------------------------------------------------------------------------- |
| [code-quality.md](code-quality.md)                 | Choix outils & approche globale (hexagonal, REST only, TDD, Railway…)           |
| [hexagonal-guide.md](hexagonal-guide.md)           | Structure des modules, règles de dépendance ESLint, recette use-case, events    |
| [naming.md](naming.md)                             | Conventions de fichiers, classes, ports, DTOs, erreurs, tests, commits          |
| [dependency-injection.md](dependency-injection.md) | Constructor injection, ports/Symbol tokens, SOLID, scopes Nest, modules globaux |
| [lifecycle.md](lifecycle.md)                       | Hooks Nest, shutdown SIGTERM Railway, connexions lazy, health checks            |
| [error-handling.md](error-handling.md)             | `DomainError` + `Result`, convention `code → HTTP`, filter RFC 7807, 503 ≠ 500  |
| [api-design.md](api-design.md)                     | Versioning URI, DTOs/mappers, pipes, guards, pagination cursor, idempotency     |
| [config.md](config.md)                             | Variables d'env, schéma Zod, règles prod, secrets Railway, `ConfigService` typé |
| [migrations.md](migrations.md)                     | drizzle-kit, schémas par module, `node dist/migrate` en pré-déploiement         |
| [jobs-and-pipeline.md](jobs-and-pipeline.md)       | BullMQ : pipeline PDF → texte → SSML → TTS → VTT, idempotence, quota, retries   |
| [testing-strategy.md](testing-strategy.md)         | Unit / Integration (Testcontainers) / E2E hermétiques + coverage gates          |
| [performance-rules.md](performance-rules.md)       | DB, cursor, N+1, transactions, cache, payload mobile, stockage objet            |
| [security-baseline.md](security-baseline.md)       | Secrets, validation, OTP/sessions, rate-limit, webhooks HMAC, PDF, logs         |
| [observability.md](observability.md)               | Pino + redaction, `x-request-id` ALS, slow-query logger, health, alerting MVP   |
| [workflow.md](workflow.md)                         | Conventional Commits + scope, hooks Husky, ADR avant code, scope minimal        |

## ADRs

Les décisions architecturales sont dans [`../adr/`](../adr/). Consulte-les pour
comprendre **pourquoi** une règle existe avant de la contester. Spécifications
produit de référence : `../../../doc-projet/` (Cahier des charges v3, SRS v2,
SDD v1) — les identifiants `RF-xx` / `RNF-xx` / `DEC-xx` cités ici y renvoient.

## Comment contribuer à ces docs

- Ces fichiers sont chargés en contexte par les IA (Claude, CodeRabbit) à chaque review.
- Garde chacun **court et directif** (~150 lignes max).
- Pour une décision importante → écris un ADR, ne charge pas ces docs.
- Pour un exemple concret → préfère 1 snippet tiré du code réel (`health`,
  `identity`, `shared/`) plutôt que 10 variations hypothétiques.
- Quand le code diverge d'un doc : c'est le doc qu'on corrige dans la même PR.
