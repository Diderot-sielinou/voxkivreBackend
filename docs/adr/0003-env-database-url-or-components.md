# 0003. Configuration Postgres/Redis : URL (Railway) ou composants

- Statut : accepted
- Date : 2026-09-12
- Tags : `config`, `déploiement`

## Contexte

cinaf-engine (ECS/Terraform) reçoit `DB_HOST`, `DB_PORT`, `DB_NAME`,
`DB_USER`, `DB_PASSWORD` séparément (le mot de passe vient de Secrets
Manager). Railway, la cible Voxlivre, injecte `DATABASE_URL` et `REDIS_URL`.
En local (docker-compose), les composants sont plus lisibles et évitent
d'encoder un mot de passe dans une URL.

## Décision

Le schéma d'env accepte les **deux formes** ; l'URL prime si présente. Une
seule règle, appliquée à trois endroits qui doivent rester cohérents :
`DrizzleModule`, `RedisModule` (+ `RateLimitRedisModule`) et
`drizzle.config.ts` (drizzle-kit ne passe pas par Zod). Le module `health`
dérive ses cibles de sonde selon la même règle (`buildProbeTargets`).

Un `superRefine` garantit qu'au moins une forme Postgres est fournie ; Redis
reste optionnel hors production (boot dégradé : rate-limit in-memory).

## Conséquences

- Zéro traduction côté plateforme : les variables Railway sont consommées telles quelles.
- Toute nouvelle dépendance réseau suit le même pattern (`X_URL` ou `X_HOST`/`X_PORT`).
