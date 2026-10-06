# Jobs asynchrones & pipeline de conversion — voxlivre-api

Cœur produit : PDF → texte → (validation utilisateur) → SSML → TTS avec
timepoints → WebVTT + audio. Chaque étape dure de secondes à minutes et
coûte de l'argent (TTS facturé au caractère). Règle absolue d'AGENTS.md :
**tout travail > 200 ms est un job BullMQ**, et **chaque étape est
idempotente** (RNF-12) — un retry ne refacture ni TTS ni quota.

## Découpage

```
HTTP POST /v1/documents/:id/upload-confirmation
  └─ queue `document`        extract-text   PDF → pages de texte, PDF supprimé      → document text_ready
     (l'utilisateur relit/corrige le texte : RF-06 — hors queue)
HTTP POST /v1/documents/:id/conversions
  └─ StartConversionUseCase : réserve le quota + crée la conversion (1 transaction, ADR-0010)
queue `conversion-prepare`   prepare-conversion   texte → segments SSML ≤ 4 800 octets  → synthesizing
queue `conversion-synthesis` synthesize-segment   1 job PAR segment, cache par empreinte → synthesized
(2c) assemble-output : WebVTT + manifeste → ready ; notification
```

Une étape = un worker = un use-case. Le **worker ne contient aucune
logique métier** : il valide le payload (Zod), appelle le use-case, et
traduit l'issue (payload invalide ou erreur métier → `UnrecoverableError`,
échec **définitif** sans retry ; panne d'infrastructure → throw pour retry).

Pas de `@nestjs/bullmq` (ADR-0009) : `createJobWorker()` (`shared/queue`)
crée le `Worker` BullMQ avec **sa** connexion Redis et renvoie un handle
dont `close()` ferme le worker puis la connexion. Exemple réel :
`src/modules/document/infrastructure/queue/document-extraction.worker.ts`.

```ts
@Injectable()
export class DocumentExtractionWorker
  implements JobHandler, OnApplicationBootstrap, OnApplicationShutdown
{
  onApplicationBootstrap(): void {
    if (!this.config.get('JOB_WORKERS_ENABLED', { infer: true })) return;
    this.worker = createJobWorker(DOCUMENT_QUEUE, this, buildRedisOptions(this.config), 1);
  }
  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close(); // attend la tâche en cours
  }
  async handle(job: Job): Promise<void> {
    const parsed = extractTextPayload.safeParse(job.data); // validé avant typage
    if (!parsed.success) throw new UnrecoverableError('Invalid extract-text payload');
    await this.extract.execute(DocumentId.of(parsed.data.documentId));
  }
  async onFinalFailure(job: Job): Promise<void> {
    /* essais épuisés → statut d'échec en base (RNF-11) */
  }
}
```

## Idempotence — comment on la garantit

| Mécanisme                    | Rôle                                                                                                                                                    |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `jobId` déterministe         | `conversion:<conversionId>:synthesize:<segmentIndex>` — BullMQ dédoublonne un enqueue répété.                                                           |
| Machine à états en base      | Le use-case lit l'état courant ; si l'étape est déjà faite (`segment.audioKey != null`), il **retourne OK sans appeler le fournisseur**.                |
| Clé de stockage déterministe | `conversions/<id>/segments/<index>.mp3` — un re-upload écrase, ne duplique pas.                                                                         |
| Réservation au lancement     | Le quota est réservé une fois, avec la conversion, dans une transaction (ADR-0010) ; la synthèse ne touche plus au quota. Échec → remboursement unique. |
| Cache par empreinte (RNF-26) | `tts-cache/<sha256>.mp3` + `.json` : un segment déjà synthétisé (par n'importe quelle conversion) n'est pas repayé.                                     |
| Idempotence fonctionnelle    | Une conversion active par (document, voix, révision du texte), index unique partiel : le double lancement renvoie l'existante, sans débit.              |

Le fournisseur TTS est appelé **hors** transaction (réseau lent) ; le
segment est marqué synthétisé par un `UPDATE … WHERE audio_key IS NULL`.

## Configuration des jobs

- `attempts: 3`, `backoff: { type: 'exponential', delay: 5_000 }` par défaut ;
  TTS/OCR : `attempts: 5` (fournisseurs 5xx transitoires).
- `timeout` explicite par type de job (extract : 2 min, synthesize : 5 min).
- `removeOnComplete: { age: 24h }`, `removeOnFail: false` (inspection).
- Un job échoué après N tentatives → statut `FAILED` en base + event
  `ConversionFailed` (RNF-11 : l'utilisateur est informé, jamais un échec
  silencieux) — pas de dead-letter queue séparée au MVP, la base est la DLQ.
- Concurrency par worker bornée par le **quota fournisseur** (TTS QPS), pas
  par le CPU.

## Clients Redis (ADR-0009)

- **Workers** : une connexion par worker (`createJobWorker`),
  `maxRetriesPerRequest: null` — un worker **doit** attendre la reconnexion.
- **Producteur** (`JOB_QUEUE`, appelé depuis les requêtes HTTP) : client
  dédié `enableOfflineQueue: false`, `commandTimeout: 1000`. Redis arrêté →
  `INFRASTRUCTURE_QUEUE_UNAVAILABLE` en quelques ms, jamais une requête qui
  pend (même leçon qu'ADR-0002).
- Quand l'opération HTTP a **déjà réussi** en base (upload confirmé,
  conversion créée avec son quota réservé), la mise en file ratée n'est pas
  renvoyée en erreur : elle est loggée et un **balayage périodique**
  reprogramme l'étape (le statut en base est la source de vérité). Un 503
  n'est renvoyé que si l'opération HTTP n'est **que** la mise en file.

## Un seul processus (ADR-0009)

L'API et les workers tournent dans le **même processus** (un service
Railway). Le travail CPU (pdf.js) rend la main à la boucle d'événements
entre chaque page ; mesuré : 300 pages extraites en ~0,6 s, p95 de `/health`
inchangé (4,4 → 4,8 ms). `JOB_WORKERS_ENABLED=false` désactive les workers
(e2e ; plus tard une instance "API seule").

## Frontières

- **Processor** (`infrastructure/queue/`) : glue BullMQ ↔ use-case. Zéro règle métier.
- **Use-case** (`application/`) : lit l'état, décide, appelle les ports
  (`TtsPort`, `StoragePort`, `ConversionRepositoryPort`, `QuotaPort`), écrit.
- **Ports** (`domain/ports/`) : `JobQueuePort.enqueue(name, payload, { jobId })`
  pour que `application/` n'importe jamais `bullmq`.
- Payload de job = **IDs + paramètres**, jamais une entité ni un blob. Validé
  par Zod à l'entrée du processor (un job peut avoir été créé par une version
  précédente du code).

## Observabilité

- Chaque job logge `{ queue, jobName, jobId, conversionId, attempt, durationMs }` en début/fin.
- Le `requestId` de la requête HTTP d'origine est propagé dans le payload
  (`originRequestId`) et remis dans le contexte ALS par le processor.
- Coût : chaque appel TTS logge `{ provider, characters, voiceId }` — c'est
  la facture.
- `/health/services` ne couvre pas la profondeur des queues ; un job `cron`
  (`@nestjs/schedule`) alerte (log `error`) si une conversion reste
  `PENDING` > 15 min.

## Suppression du PDF (CdC §8)

Le PDF source est supprimé du stockage objet **dès** que le texte est
extrait et persisté (fin de `extract-text`), avant toute étape TTS. Aucune
copie n'est conservée ; seul le texte (propriété de l'utilisateur, corrigé
par lui) et les sorties générées restent. Un job de réconciliation
quotidien supprime tout PDF orphelin > 24 h.

## Anti-patterns

- ❌ Extraction PDF / appel TTS dans le request lifecycle
- ❌ Processor qui contient un `if` métier (quota, état) — c'est le use-case
- ❌ Job sans `jobId` déterministe sur une étape coûteuse
- ❌ Appel fournisseur **dans** une transaction
- ❌ Appeler le fournisseur TTS sans quota réservé (ADR-0010)
- ❌ Retry sur une erreur métier (`QUOTA_EXCEEDED` ne se résout pas en réessayant)
- ❌ `import { Queue } from 'bullmq'` dans `application/`
- ❌ Payload de job contenant le texte complet (500 k caractères dans Redis)
