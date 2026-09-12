# Tests — voxlivre-api

| Couche      | Fichiers                 | Config                       | Commande                                         |
| ----------- | ------------------------ | ---------------------------- | ------------------------------------------------ |
| Unit        | `src/**/*.spec.ts`       | `test/jest-unit.json`        | `pnpm test`                                      |
| Intégration | `src/**/*.int.spec.ts`   | `test/jest-integration.json` | `pnpm test:int` (Docker requis — Testcontainers) |
| E2E         | `test/e2e/*.e2e-spec.ts` | `test/jest-e2e.json`         | `pnpm test:e2e`                                  |

Voir `docs/code-engineering/testing-strategy.md` pour la pyramide et les règles.
