# 0006. Validation : `class-validator` pour les DTOs HTTP, Zod pour le reste

- Statut : accepted
- Date : 2026-10-06
- Tags : `api`, `sécurité`, `dx`

## Contexte

`AGENTS.md` : tout input externe est validé **avant** typage. Voxlivre a
deux familles d'inputs :

1. **DTOs HTTP** du mobile (body, query) — déjà validés par le
   `ValidationPipe` global (`whitelist`, `forbidNonWhitelisted`,
   `transform`) dans `api.bootstrap.ts`, et décrits dans Swagger via
   `@nestjs/swagger` à partir des mêmes décorateurs.
2. **Payloads non-DTO** : variables d'environnement (déjà Zod,
   `env.schema.ts`), payloads de jobs BullMQ (pipeline de conversion —
   un job peut avoir été créé par une version précédente du code),
   webhooks Mobile Money (forme imposée par l'agrégateur), réponses des
   fournisseurs TTS/OCR.

`class-validator` exige des classes décorées : inadapté aux payloads
dynamiques. Zod pour les DTOs HTTP exigerait `nestjs-zod` ou un générateur
OpenAPI maison.

## Options

1. **`class-validator` (DTOs HTTP) + Zod (tout le reste).** Aucun churn,
   Swagger inchangé, Zod là où il excelle.
2. **Tout en Zod** (`nestjs-zod`) : une seule lib, mais migration des DTOs
   existants et risque de désynchro OpenAPI ↔ schéma.
3. **Tout en `class-validator`** : classes décorées pour valider un
   webhook ou un job — boilerplate, et `env.schema.ts` à réécrire.

## Décision

**Option 1.** Règle unique, sans exception : **DTO HTTP entrant →
`class-validator` ; tout le reste → Zod**. Jamais les deux sur le même
input.

- Payload de job BullMQ : `schema.parse(job.data)` en tête du processor
  (cf. [jobs-and-pipeline.md](../code-engineering/jobs-and-pipeline.md)).
- Webhook : un `ZodValidationPipe` dans `src/shared/http/` sera créé avec
  le **premier** webhook (module `payment`) — pas avant (règle « pas de
  code au cas où »). Échec de parsing → `ValidationError` du kernel
  (`VALIDATION_FAILED`) → 422 Problem Details
  avec le détail des champs.
- Réponse d'un fournisseur externe : parsée par Zod dans l'adaptateur
  (`infrastructure/`) ; une forme inattendue devient une
  `InfrastructureError` (503), jamais un `undefined` propagé au domaine.

## Conséquences

- Deux bibliothèques à connaître, mais un périmètre séparé sans ambiguïté.
- Swagger reste généré depuis les DTOs : le contrat mobile est documenté
  sans outil supplémentaire.
- À rouvrir si les nouveaux DTOs penchent massivement vers Zod, ou si
  `class-validator` bloque une montée de version TypeScript.
- Liens : [api-design.md](../code-engineering/api-design.md),
  [security-baseline.md](../code-engineering/security-baseline.md).
