# Workflow — voxlivre-api

Solo dev, mais discipline d'équipe : l'historique git et les ADRs sont la
mémoire du projet (et le contexte des agents IA).

## Commits — Conventional Commits, scope obligatoire

`<type>(<scope>): <sujet impératif, lowercase, sans point final>` — header ≤ 100 chars (commitlint).

- **Types** : `feat`, `fix`, `chore`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `revert`.
- **Scope** = module hexagonal touché (`health`, `identity`, `document`,
  `conversion`, `library`, `billing`, `payment`, `notification`) ou
  transverse : `shared`, `bootstrap`, `tooling`, `deps`, `ci`, `docs`.
- Un commit = **un sujet**. Un refactor opportuniste va dans son propre commit.
- Corps : le **pourquoi** et les conséquences (migration ? variable d'env ?
  breaking pour le mobile ?). Référence `RF-xx` / `RNF-xx` / ADR quand pertinent.

```
feat(conversion): enqueue synthesize-audio jobs per SSML segment

Un job par segment (jobId déterministe) pour que le retry d'un segment
n'entraîne pas la resynthèse des autres (RNF-12). Voir jobs-and-pipeline.md.
```

## Hooks Git (Husky)

| Hook         | Commande                         | Ce qu'il garantit                                                              |
| ------------ | -------------------------------- | ------------------------------------------------------------------------------ |
| `pre-commit` | `lint-staged` + `pnpm typecheck` | ESLint `--max-warnings 0` + Prettier sur les fichiers stagés ; pas d'erreur TS |
| `commit-msg` | `commitlint --edit`              | Format + scope obligatoire                                                     |
| `pre-push`   | `pnpm test:all` (unit + e2e)     | Rien de rouge ne part                                                          |

`--no-verify` : uniquement avec la raison dans le message de commit
(ex. `chore(docs): fix typo [skip hooks: docs only]`). Jamais pour
contourner un test qui échoue.

`test:int` (Testcontainers) n'est pas dans le pre-push (Docker requis) : à
lancer à la main avant toute PR qui touche `infrastructure/persistence` ou
une migration.

## CI (GitHub Actions)

`.github/workflows/ci.yml`, sur chaque push et PR vers `master` : `lint`,
`typecheck`, `unit` (gate de couverture), `e2e`, `integration`
(Testcontainers), `build` et `gitleaks` (historique complet). Jobs en
parallèle ; à déclarer en « required status checks » dans la protection de
branche `master` pour qu'un job rouge bloque le merge. La CI revérifie ce que les
hooks vérifient en local, plus `test:int` et le scan de secrets — c'est le
garde-fou que `--no-verify` ne contourne pas. Pas de job de déploiement :
Railway déploie depuis GitHub.

## Branches & PRs

- `master` = déployable. Feature branches `feat/<scope>-<sujet>`, `fix/…`.
- **`master` est protégée** (ruleset GitHub) : tout changement passe par une
  PR, avec les 6 checks requis au vert (Lint, Typecheck, Unit tests,
  E2E tests, Build, gitleaks). Aucune approbation requise (solo dev) ; merge
  par commit de merge pour garder les commits de la branche intacts.
- Une PR = un sujet. Description : contexte, ce qui change, comment tester,
  impacts (migration, env, contrat mobile).
- Checklist avant merge : tests verts, `pnpm drizzle:check` OK si schéma,
  `.env.example` à jour si nouvelle variable, doc `code-engineering` corrigée
  si le code diverge, ADR écrit si décision.

## ADR **avant** le code

Toute décision structurante (nouveau fournisseur, nouveau module, format de
donnée, stratégie de retry, changement de contrat mobile) → ADR dans
`docs/adr/` (`_template` de cinaf, format `NNNN-titre-kebab.md`) **avant**
l'implémentation. L'ADR est court : contexte, options, décision, conséquences.
Un agent IA qui hésite entre deux patterns propose un ADR, n'invente pas.

## Releases & déploiement

- Railway build l'image depuis le `Dockerfile` à chaque push `master`.
- Pré-déploiement : `node dist/migrate` (cf. [migrations.md](migrations.md)).
- Version dans `package.json` (SemVer) bumpée manuellement sur jalon produit ;
  tag git `vX.Y.Z`. Changelog généré depuis les commits (outil à choisir par ADR).
- Rollback = redeploy de l'image précédente sur Railway ; d'où l'obligation
  expand → contract côté schéma.

## Dépendances

- `pnpm` 11 via Corepack (`packageManager` dans `package.json` = source de vérité).
- Ajouter une dépendance = justifier dans la PR (taille, maintenance, licence).
  Un SDK fournisseur n'est importé **que** dans son adapter.
- Bumps : Dependabot hebdo groupé ; majeurs à la main avec lecture du changelog.

## Anti-patterns

- ❌ `feat: add stuff` (pas de scope, sujet vague)
- ❌ Commit qui mélange migration + code + refactor
- ❌ `--no-verify` silencieux
- ❌ Décision d'architecture dans une description de PR au lieu d'un ADR
- ❌ Doc `code-engineering` qui contredit le code sans PR de correction
