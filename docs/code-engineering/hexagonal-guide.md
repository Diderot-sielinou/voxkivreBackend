# Hexagonal Guide — voxlivre-api

Référence pratique. Justification : [ADR-0001](../adr/0001-hexagonal-architecture.md).
Exemple vivant : `src/modules/health/`.

## Structure d'un module

```
src/modules/<domain>/
  domain/
    entities/                # entités métier avec invariants (Document, Conversion, Wallet…)
    value-objects/           # types enrichis (CharCount, VoiceId, ReadingPosition…)
    ports/                   # interfaces de ce que le domain CONSOMME (+ token Symbol)
    events/                  # domain events (classes pures)
    errors/                  # DomainError typées + error-codes.ts local
  application/
    use-cases/               # 1 fichier = 1 use-case (verbe métier) + .spec.ts
    services/                # orchestration multi-use-cases si besoin
  infrastructure/
    persistence/             # adapter Drizzle + schema/*.schema.ts (glob drizzle-kit)
    queue/                   # processors BullMQ (aucune logique métier)
    external/                # clients TTS / OCR / paiement / stockage
    config/                  # dérivations d'env spécifiques au module
  interface/
    http/
      controllers/  dto/  mappers/
  <domain>.module.ts         # wiring Nest : ports ↔ adapters
```

## Règles de dépendance (bloquantes, ESLint)

```
interface  →  application  →  domain
                  ↑              ↓
              infrastructure ----┘   (implémente les ports domain)
```

## Recette pour un nouveau use-case (checklist)

1. `domain/` : entité / VO + erreurs (`XXX_NOT_FOUND`, `INVALID_XXX`…) + port si nouveau besoin externe.
2. `application/use-cases/<verbe>.use-case.ts` : `execute(): Promise<Result<T, DomainError>>`, ports injectés via `@Inject(TOKEN)`.
3. `.spec.ts` à côté : ports mockés par de simples objets, aucun Nest.
4. `infrastructure/` : adapter (+ `.int.spec.ts` Testcontainers si DB/Redis).
5. `interface/http/` : DTO (class-validator + `@ApiProperty`), mapper, controller (`Result` → `throw r.error` pour laisser le filter RFC 7807 répondre).
6. `<domain>.module.ts` : `{ provide: TOKEN, useClass: Adapter }`.
7. e2e : override des ports par des fakes, supertest.

## Anti-patterns

- ❌ Entité de domaine renvoyée par un controller.
- ❌ `import { db }` dans un use-case (utiliser un port).
- ❌ Logique métier dans un controller ou un processor BullMQ.
- ❌ `throw new Error()` dans le domain (toujours `DomainError` via `Result`).
- ❌ `new Date()` dans domain/application (utiliser `CLOCK`).

## Domain events

Classes pures dans `domain/events/`, publiées à la **fin** d'un use-case
réussi via un port `EventBusPort` (impl `EventEmitter2` en infrastructure).
Handlers idempotents. Payload = IDs + métadonnées minimales, jamais une
entité entière. Durabilité requise (notification, facturation) → BullMQ.
