# 0005. Pagination par cursor opaque signé HMAC (codec dans le kernel)

- Statut : accepted
- Date : 2026-10-06
- Tags : `api`, `performance`, `sécurité`

## Contexte

`AGENTS.md` interdit OFFSET : tout listing (bibliothèque RF-17, historique
de conversions, transactions de paiement) pagine par cursor. Deux raisons
propres à Voxlivre :

- OFFSET dégrade linéairement et **saute ou duplique des lignes** quand la
  liste bouge pendant le scroll — or la bibliothèque change pendant qu'une
  conversion se termine en arrière-plan.
- Le client mobile est déployé sur les stores : on ne le corrige pas vite.
  Le format du cursor doit être opaque pour pouvoir évoluer côté serveur
  sans casser les versions installées.

Sans format unique, chaque module réinventerait le sien (base64 brut, JSON
nu), avec un cursor modifiable par le client et une structure interne
exposée.

## Options

1. **base64url(payload) + HMAC-SHA256, factory pure dans `shared/kernel`.**
   Opaque, inaltérable (signature), sans état serveur, versionné (`v`).
2. **JWT** : standard, mais claims inutiles et une dépendance de plus pour
   un bénéfice nul ici.
3. **base64 brut non signé** : le client peut forger un cursor → résultats
   incohérents, requêtes arbitraires. Refusé.
4. **Cursor stocké en Redis, token court côté client** : inaltérable, mais
   TTL à gérer et dépendance Redis sur le chemin de lecture — contraire à
   ADR-0002 (l'API doit servir la bibliothèque même Redis tombé).

## Décision

**Option 1.** Format `<base64url(payload)>.<base64url(hmac)>` avec
`payload = { s: sortKey, i: id, v: 1 }`. Le kernel n'exporte que
`createCursorCodec(secret)` et `buildPage(rows, limit, …)` — aucune
dépendance Nest ; le secret est injecté par le module consommateur.

- Secret : `CURSOR_HMAC_SECRET` (≥ 32 caractères), optionnel en dev,
  **requis en production** (règle `PRODUCTION_RULES` de `env.schema.ts`),
  variable Railway.
- Cursor altéré, signé avec un autre secret ou mal formé →
  `INVALID_CURSOR` → 422 Problem Details.
- Tri stable `(sortKey, id)` + index composite correspondant ; `limit`
  borné côté serveur (max 50, payload mobile).

## Conséquences

- Un seul codec pour toute l'API ; le contrat client dit simplement
  « `nextCursor` opaque, `null` en fin de liste ».
- Pas de « nombre total de pages » : acceptable, le mobile fait du scroll
  infini.
- Rotation du secret = tous les cursors en vol deviennent invalides : le
  mobile doit traiter un 422 `INVALID_CURSOR` en rechargeant depuis le début.
- Un changement de forme du payload incrémente `v` (cursors anciens rejetés
  proprement plutôt que mal interprétés).
- Liens : [api-design.md](../code-engineering/api-design.md),
  [performance-rules.md](../code-engineering/performance-rules.md),
  `src/shared/kernel/pagination.ts`.
