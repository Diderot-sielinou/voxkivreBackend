# Migrations — voxlivre-api

Toute modification de schéma passe par une **migration SQL versionnée**
générée par drizzle-kit et relue à la main. Jamais d'`ALTER TABLE` manuel
sur la base Railway.

## Outil & emplacement

```
src/modules/*/infrastructure/persistence/schema/*.schema.ts   # schémas Drizzle, un par module (glob drizzle.config.ts)
src/shared/persistence/migrations/                            # .sql générés + meta/_journal.json
src/migrate.ts                                                # runner prod : `node dist/migrate`
```

```bash
pnpm drizzle:generate   # génère un .sql depuis le diff des *.schema.ts
pnpm drizzle:check      # cohérence schémas ↔ migrations (CI)
pnpm migrate:dev        # applique sur le compose local (ts-node)
pnpm drizzle:migrate    # équivalent drizzle-kit
```

Ajouter un schéma = créer `<name>.schema.ts` dans le module ; `drizzle.config.ts`
n'est pas à toucher (glob). Chaque table appartient à **un** module ; un autre
module qui a besoin de la donnée passe par un port de requête, pas par un
import du schéma.

## Exécution

### Local / tests

- `pnpm migrate:dev` sur le Postgres du docker-compose.
- Tests d'intégration : `startMigratedPostgres()` (`test/support/testcontainers.ts`)
  lance un Postgres jetable et applique **toutes** les migrations du repo — un
  `.sql` cassé est vu ici, pas en prod.

### Production (Railway)

- L'image copie `src/shared/persistence/migrations` dans `/app/migrations`.
- `node dist/migrate` est la **commande de pré-déploiement** Railway : elle
  tourne avant que le nouveau container ne reçoive du trafic ; exit code ≠ 0
  → déploiement annulé, l'ancienne version reste.
- Jamais au boot de l'app (`OnModuleInit`) : race entre instances, pas de
  rollback isolé.
- Le runner utilise `max: 1`, `prepare: false`, et la même règle
  `DATABASE_URL` ou composants que l'app (ADR-0003).

## Principe : expand → contract

Même sur une instance unique, un déploiement Railway fait cohabiter
brièvement l'ancien et le nouveau container. Un changement de schéma doit
donc être **backward-compatible** avec le code encore en ligne.

| Changement                | Recette                                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Ajouter une colonne       | Nullable ou avec `DEFAULT` → 1 migration. `NOT NULL` sans default → add nullable, backfill, puis contrainte. |
| Renommer une colonne      | Jamais en 1 coup : add `new`, double-écriture, backfill, deploy code lisant `new`, drop `old`.               |
| Changer un type           | Compatible (`varchar(50)` → `varchar(200)`, `int` → `bigint`) → safe. Sinon expand/contract.                 |
| Supprimer colonne / table | Deploy code qui ne l'utilise plus, **puis** migration de drop (PR séparée).                                  |
| Index                     | Voir ci-dessous.                                                                                             |
| FK sur table existante    | `NOT VALID` puis `VALIDATE CONSTRAINT` séparément si la table est grosse.                                    |

### Index

Le migrator Drizzle exécute chaque fichier dans une transaction ;
`CREATE INDEX CONCURRENTLY` y est **impossible**. À l'échelle MVP (tables de
quelques dizaines de milliers de lignes), un `CREATE INDEX` classique est
acceptable — il tient en millisecondes. Le jour où une table dépasse
quelques millions de lignes : script dédié hors migrator, à tracer par ADR.

Tout index a un nom explicite : `<table>_<cols>_idx`, unique :
`<table>_<cols>_key`.

## Règles

- **Relire le SQL généré** avant de committer : drizzle-kit génère parfois un
  `DROP` + `CREATE` là où on voulait un `ALTER`.
- **Pas de logique métier** dans une migration. Backfill non trivial = script
  `scripts/` paginé par batch ou job BullMQ.
- **Pas de migration data-only** mélangée à un changement de schéma.
- **Idempotence** garantie par le journal `__drizzle_migrations` — ne jamais
  éditer un `.sql` déjà appliqué en prod ; en générer un nouveau.
- **Ordre de déploiement** schema + code : PR migration expand → deploy → PR
  code → deploy → PR contract → deploy. Jamais tout en un.
- `pnpm drizzle:check` en CI (`lint`/`typecheck`) pour détecter un drift.
- Tables **possédées par better-auth** (`user`, `session`, `account`,
  `verification`, `rate_limit`) : le schéma est dans
  `identity/infrastructure/persistence/schema/auth.schema.ts` et suit les
  versions de la lib ; on n'y ajoute que des colonnes additionnelles
  (`role`, `phone_number`) déclarées dans `better-auth.config.ts`.

## Conventions de schéma

- Tables et colonnes en `snake_case`, singulier pour les tables better-auth
  (imposé), pluriel pour les nôtres (`documents`, `conversions`).
- PK `id` : UUID (v7 généré applicativement via `shared/kernel/uuid.ts`)
  pour les entités exposées au client.
- `created_at` / `updated_at` `timestamptz` en UTC, `NOT NULL DEFAULT now()`.
- Montants : `bigint` en sous-unité, jamais `numeric`/`float`.
- Compteurs de quota (caractères) : `bigint`.
- Pas de JSON non typé pour des données requêtées ; `jsonb` toléré pour des
  métadonnées fournisseur opaques (réponse brute d'un webhook, timepoints TTS).

## Anti-patterns

- ❌ Migration qui tourne au boot du container
- ❌ `ALTER TABLE` à la main sur la base Railway
- ❌ Rename / drop en un seul deploy
- ❌ Éditer un `.sql` déjà appliqué
- ❌ Importer le `*.schema.ts` d'un autre module
- ❌ Backfill non paginé
- ❌ Migration non testée (`pnpm test:int`) avant merge
