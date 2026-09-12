# 0000. Tracer les décisions d'architecture dans des ADRs

- Statut : accepted
- Date : 2026-09-12

## Contexte

Voxlivre est développé en solo, avec assistance IA, en s'inspirant d'un
backend mature (cinaf-engine). Sans trace écrite, les "pourquoi" se perdent
et les choix sont rediscutés — ou pire, défaits par un agent qui ne les
connaît pas.

## Décision

Toute décision structurante (architecture, contrat, dépendance externe,
compromis sécurité/disponibilité) est consignée dans `docs/adr/NNNN-slug.md`
avec : contexte, options considérées, décision, conséquences. Une ADR n'est
jamais réécrite : elle est remplacée par une nouvelle qui la référence.

## Conséquences

- `AGENTS.md` pointe vers les ADRs ; les agents IA les lisent avant d'agir.
- Le coût (15 min par ADR) est largement compensé par les débats évités.
