# Jobs asynchrones & pipeline de conversion — voxlivre-api

Cœur produit : PDF → texte → (validation utilisateur) → SSML → TTS avec
timepoints → WebVTT + audio. Chaque étape dure de secondes à minutes et
coûte de l'argent (TTS facturé au caractère). Règle absolue d'AGENTS.md :
**tout travail > 200 ms est un job BullMQ**, et **chaque étape est
idempotente** (RNF-12) — un retry ne refacture ni TTS ni quota.

## Découpage

```
HTTP POST /v1/documents/:id/conversions   (Idempotency-Key)
  └─ StartConversionUseCase  → crée Conversion(status=PENDING), enqueue `extract-text`
queue `conversion`
  ├─ extract-text       : PDF (stockage objet) → texte brut (+ OCR si scanné)     → status=TEXT_READY
  │                       puis SUPPRESSION du PDF source (CdC §8)
  │   (l'utilisateur relit/corrige le texte : RF-06 — hors queue)
  ├─ build-ssml         : texte validé → SSML segmenté (limites fournisseur)        → status=SSML_READY
  ├─ synthesize-audio   : SSML → audio + timepoints, 1 job PAR segment            → status=AUDIO_READY
  │                       débit du quota en caractères, atomique avec l'état
  └─ assemble-output    : concat audio + génération WebVTT → stockage objet        → status=COMPLETED
                          domain event ConversionCompleted → notification
```

Une étape = un processor = un use-case. Le **processor ne contient aucune
logique métier** : il désérialise le payload, appelle le use-case, traduit
le `Result` (erreur métier → job terminé en échec **définitif**, sans retry ;
`InfrastructureError` → throw pour retry).

```ts
@Processor(CONVERSION_QUEUE)
export class SynthesizeAudioProcessor extends WorkerHost {
  constructor(private readonly synthesize: SynthesizeSegmentUseCase) {
    super();
  }

  async process(job: Job<SynthesizeSegmentPayload>): Promise<void> {
    const input = synthesizeSegmentPayloadSchema.parse(job.data); // validé avant typage
    const result = await this.synthesize.execute(input);
    if (result.isErr()) throw new UnrecoverableError(result.error.code); // pas de retry sur erreur métier
  }
}
```

## Idempotence — comment on la garantit

| Mécanisme                     | Rôle                                                                                                                                                  |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `jobId` déterministe          | `conversion:<conversionId>:synthesize:<segmentIndex>` — BullMQ dédoublonne un enqueue répété.                                                         |
| Machine à états en base       | Le use-case lit l'état courant ; si l'étape est déjà faite (`segment.audioKey != null`), il **retourne OK sans appeler le fournisseur**.              |
| Clé de stockage déterministe  | `conversions/<id>/segments/<index>.mp3` — un re-upload écrase, ne duplique pas.                                                                       |
| Débit de quota transactionnel | `UNIT_OF_WORK.withTransaction` : `UPDATE segment SET audio_key … WHERE audio_key IS NULL` + débit. 0 ligne affectée → déjà facturé, on ne débite pas. |
| `Idempotency-Key` HTTP        | Le lancement de conversion (coût) rejoue la réponse sur retry mobile (réseau instable).                                                               |

Le fournisseur TTS est appelé **hors** transaction (réseau lent) ; la
transaction ne fait que l'écriture "résultat + débit".

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

## Client Redis

- BullMQ utilise le client partagé `REDIS_CLIENT` (`maxRetriesPerRequest: null`,
  offline queue) : un worker **doit** attendre la reconnexion.
- Ce réglage est **interdit** sur le chemin de requête HTTP (ADR-0002) : le
  throttler a son propre client `RATE_LIMIT_REDIS_CLIENT` court-circuité.
- Redis indisponible → `POST /conversions` renvoie 503 `INFRASTRUCTURE_*`
  (enqueue impossible), jamais un 500 ni un succès fantôme.

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
- ❌ Débiter le quota avant d'avoir la confirmation du fournisseur
- ❌ Retry sur une erreur métier (`QUOTA_EXCEEDED` ne se résout pas en réessayant)
- ❌ `import { Queue } from 'bullmq'` dans `application/`
- ❌ Payload de job contenant le texte complet (500 k caractères dans Redis)
