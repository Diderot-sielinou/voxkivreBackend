# 0009. Tâches asynchrones : BullMQ derrière un port, workers dans le processus de l'API

- Statut : accepted
- Date : 2026-10-06
- Tags : `jobs`, `pipeline`, `résilience`, `coût`

## Contexte

L'extraction du texte (puis la synthèse vocale) dure de quelques centaines
de millisecondes à plusieurs minutes : elle ne peut pas vivre dans une
requête HTTP (AGENTS.md, RNF-01). Chaque étape doit être rejouable sans
perte ni double facturation (RNF-12). Budget serré : chaque service Railway
supplémentaire coûte environ 5 $/mois.

## Options

1. **Workers dans le processus de l'API** (un seul service Railway), activés
   par `JOB_WORKERS_ENABLED`.
2. **Service worker séparé** (même image, autre point d'entrée) : isolation
   CPU et mise à l'échelle indépendante, mais un service de plus à payer et
   à déployer.
3. **`@nestjs/bullmq`** (`@Processor` + `WorkerHost`) plutôt qu'un code
   explicite.

## Décision

**Option 1**, choix explicite du porteur de projet pour le coût, et sans
`@nestjs/bullmq` :

- **Port `JobQueuePort`** (`shared/queue`), méthode `enqueue` (file, nom,
  `jobId`, payload) : `application/` n'importe jamais `bullmq`. `jobId`
  **déterministe** obligatoire (BullMQ ignore un id déjà présent) ; payload =
  identifiants seulement, validé par Zod dans le worker.
- **Deux réglages Redis** :
  - producteur (appelé depuis HTTP) : `enableOfflineQueue: false`,
    `commandTimeout: 1000` → 503 `INFRASTRUCTURE_QUEUE_UNAVAILABLE` en
    quelques millisecondes si Redis tombe (leçon d'ADR-0002) ;
  - workers : une connexion par worker, `maxRetriesPerRequest: null` (ils
    attendent la reconnexion).
- **`createJobWorker()`** remplace `@nestjs/bullmq` : une seule fonction
  lisible (logs homogènes, hook d'échec définitif, fermeture). BullMQ ne
  ferme pas une connexion qu'on lui fournit : le handle renvoyé ferme le
  worker **puis** sa connexion (sans ça, le processus ne s'arrêtait pas au
  redéploiement — trouvé en test d'intégration).
- **Le statut en base est la source de vérité.** Si la mise en file échoue
  alors que l'opération HTTP a réussi (upload confirmé), on ne renvoie pas
  d'erreur au mobile : un **balayage toutes les 5 minutes** reprogramme les
  documents restés `uploaded`. Une tâche qui épuise ses essais fait passer
  le document en échec avec une raison (`internal`, RNF-11) : la base sert
  de file des échecs.
- **Travail CPU coopératif** : pdf.js rend la main à la boucle d'événements
  entre chaque page ; concurrence d'extraction = 1.

## Conséquences

- Mesuré en réel : 300 pages (953 000 caractères) extraites en ~0,6 s ;
  p95 de `/health` pendant l'extraction 4,8 ms (4,4 ms au repos), pire cas
  18 ms. Redis arrêté : confirmation d'upload en 11 ms, extraction
  reprogrammée au balayage suivant.
- Pas d'isolation : un traitement CPU lourd (OCR Tesseract, RF-04) pourra
  dégrader l'API. **Critère de révision** : si le p95 des requêtes dépasse
  ~200 ms pendant les traitements, passer à l'option 2 — même image,
  `JOB_WORKERS_ENABLED=false` côté API, `true` sur le service worker. Aucun
  changement de code.
- `@nestjs/bullmq` retiré des dépendances (il n'était pas utilisé).
- Liens : [jobs-and-pipeline.md](../code-engineering/jobs-and-pipeline.md),
  [lifecycle.md](../code-engineering/lifecycle.md), `src/shared/queue/`.
