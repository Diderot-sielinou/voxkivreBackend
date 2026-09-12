# 0001. Architecture hexagonale par module métier

- Statut : accepted
- Date : 2026-09-12
- Tags : `archi`, `structure`

## Contexte et problème

Le SDD Voxlivre (§3.2, §4) impose une architecture hexagonale (ports &
adapters) et le SRS l'exige (RNF-16/17/18) : le produit dépend de nombreux
services externes appelés à changer — moteur TTS (Google → ElevenLabs),
OCR (Tesseract → Cloud Vision), paiement (Campay / Monetbil / MTN direct),
stockage objet (R2 / S3), notification. Un changement de fournisseur doit
se limiter à un nouvel adapter.

Second driver : le développement est assisté par IA. Une structure
prévisible (une responsabilité = un dossier) réduit le risque de mélange
métier/technique et facilite la revue.

## Options considérées

- **A — Hexagonale par module** : `domain/ application/ infrastructure/ interface/`
  par domaine métier. Dépendances enforcées par ESLint.
- **B — Layered Nest classique** (controller → service → repository) : les
  services finissent par mêler métier + I/O ; tests couplés à l'ORM.
- **C — Vertical slices sans hexagonal** : localité mais pas d'isolation domain/I/O.
- **D — Microservices** : injustifié pour un solo dev sans scale prouvé.

## Décision

**Option A**, reprise de cinaf-engine (ADR-0001 de ce projet) avec les
mêmes règles de dépendance :

```
interface → application → domain ← infrastructure
```

- `domain/` : TS pur. Interdits par ESLint : `@nestjs/*`, `drizzle-orm`,
  `ioredis`, `bullmq`, `express`, `better-auth`, `@aws-sdk/*`, `@google-cloud/*`.
- `application/` : use-cases (1 fichier = 1 verbe métier), dépend de ports.
- `infrastructure/` : adapters — implémentations des ports.
- `interface/` : controllers, DTOs, mappers. Zéro logique métier.
- Erreurs métier : `Result<T, DomainError>`, jamais `throw` dans domain/application.
- Cross-module : domain events (EventEmitter2 in-process ; BullMQ si durable)
  ou Query Ports — jamais d'import direct d'un autre module dans `domain/`.

## Conséquences

- ~5 fichiers minimum par use-case. Accepté : c'est le prix de la
  testabilité (use-cases testés en ms sans DB) et du remplacement d'adapter.
- Le module `health` est le gabarit de référence.
- Utilitaires purs sans variante d'implémentation (`shared/kernel`) : pas de
  port, import direct autorisé.
- Si un module importe `infrastructure/` depuis `domain/`, le build casse
  (`import-x/no-restricted-paths`).

## Liens

- [hexagonal-guide.md](../code-engineering/hexagonal-guide.md)
- cinaf-engine ADR-0001 (source d'inspiration)
