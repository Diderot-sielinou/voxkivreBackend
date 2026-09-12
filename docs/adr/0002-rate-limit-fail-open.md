# 0002. Rate-limit fail-open quand Redis est indisponible

- Statut : accepted
- Date : 2026-09-12
- Tags : `sécurité`, `disponibilité`, `redis`

## Contexte et problème

Le rate-limiter global (`@nestjs/throttler`, store Redis en prod) s'exécute
sur **chaque** requête. Observé en local : Redis arrêté ⇒ toutes les
requêtes de l'API pendent indéfiniment, y compris `/health`. Cause : le
client ioredis partagé est réglé pour BullMQ (`maxRetriesPerRequest: null`,
offline queue activée) — les commandes attendent la reconnexion sans limite.

Sur Railway, un redémarrage de Redis (deploy, maintenance) est un événement
banal. Il ne doit pas rendre l'API indisponible : l'app mobile a besoin
d'au minimum pouvoir synchroniser sa bibliothèque et reprendre une lecture.

## Options considérées

1. **Fail-open** : Redis injoignable ⇒ la requête passe, warn loggé.
   Perte temporaire de la protection anti-abus.
2. **Fail-closed** : Redis injoignable ⇒ 503 sur tout. Protection intacte,
   API morte.
3. **Fallback in-memory** : basculer sur un compteur local. Compteurs non
   partagés entre instances, complexité de resynchronisation.

## Décision

**Option 1 — fail-open**, avec :

- un client Redis **dédié** au throttler (`RateLimitRedisModule`) réglé
  "chemin de requête" : `enableOfflineQueue: false`, `commandTimeout: 250 ms`,
  `maxRetriesPerRequest: 1` ;
- un décorateur `ResilientThrottlerStorage` qui attrape toute erreur du
  store et renvoie un enregistrement permissif + `warn` ;
- `/health/services` renvoie 503 pendant l'incident (signal ops).

Le client partagé `REDIS_CLIENT` garde les réglages BullMQ : un worker
**doit** attendre la reconnexion, une requête HTTP non.

## Conséquences

- Pendant une panne Redis, l'abus du palier gratuit (RNF-28) n'est plus
  freiné par le rate-limit. Acceptable : la demande d'OTP et le lancement de
  conversion auront en plus des garde-fous **en base** (quota, compteur par
  compte) qui ne dépendent pas de Redis.
- Un incident Redis est visible dans les logs (`failing open`) et dans
  `/health/services`. À brancher sur une alerte quand il y aura un collecteur.
- À reconsidérer (fail-closed sur certaines routes) si l'abus devient réel.
