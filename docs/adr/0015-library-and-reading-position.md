# 0015. Bibliothèque et position de lecture

- Statut : accepted
- Date : 2026-10-10
- Tags : `library`, `mobile`, `multi-appareils`

## Contexte

SRS v2, niveau 2 (MVP, « Must ») :

- **RF-17** : bibliothèque personnelle avec un statut par livre (en cours,
  terminé, à reprendre) ; la détection d'un fichier local manquant est faite
  par le mobile (manifeste et empreintes, ADR-0011) ;
- **RF-18** : copie durable, retéléchargement sur un nouvel appareil — déjà
  couvert par le manifeste et ses URL signées ;
- **RF-19 / RF-20** : mémoriser la position de lecture (temps audio et
  position texte) à chaque interruption, et reprendre exactement là.

Contraintes : connexion instable (le mobile écrit hors-ligne puis
synchronise), plusieurs appareils pour un même compte (RF-18), architecture
hexagonale par module (ADR-0001) : un module ne lit pas les tables d'un autre.

## Options

1. **Module `library`** qui possède la position et **compose** la
   bibliothèque à partir des modules `document` et `conversion`, via des ports
   de requête (services exportés par ces modules, lectures groupées).
2. Ajouter la position et la bibliothèque dans `document` : mélange deux
   responsabilités, et `document` devrait lire `conversion` (dépendance
   inverse de l'existant : `conversion` dépend déjà de `document`).
3. Une vue SQL joignant les tables des trois modules : rapide, mais viole la
   propriété des tables et couple les schémas.

## Décision

**Option 1.**

1. **La position appartient à une conversion** (un texte figé à une
   révision, une voix, des horodatages) : `wordIndex` (index global du mot,
   celui du WebVTT) et `audioMs`. Une correction du texte ou un changement de
   voix produit une autre conversion, donc une position neuve — jamais une
   position fausse.
2. **Le plus récent gagne**, selon `recordedAt` fourni par le client (instant
   de l'interruption, pas de l'envoi) : une position plus ancienne que celle
   enregistrée est ignorée et la réponse renvoie la position retenue. Un
   appareil resté hors-ligne n'écrase pas la lecture faite depuis sur un
   autre. Écriture en une instruction (`INSERT … ON CONFLICT DO UPDATE …
WHERE recorded_at < excluded.recorded_at`).
3. **Validation** : la conversion doit avoir au moins une partie écoutable ;
   `wordIndex` et `audioMs` doivent tomber dans les parties assemblées ;
   `recordedAt` ne peut pas être dans le futur au-delà d'une tolérance de
   dérive d'horloge (5 min). Sinon 422 `INVALID_READING_POSITION`.
4. **Statut dérivé** d'un livre (`LibraryItemStatus`), calculé, jamais
   stocké : `processing` (extraction ou conversion en cours), `failed`,
   `not_converted` (texte prêt, aucune conversion), `ready` (écoutable,
   jamais commencé), `in_progress` (« à reprendre »), `finished` (conversion
   prête et moins de 2 % des mots restants).
5. **Conversion retenue** pour un livre : la plus récente non échouée, sinon
   la plus récente échouée — un nouvel essai raté ne masque pas un livre
   écoutable.
6. **Pagination** par cursor signé (ADR-0005) sur la date d'import
   (`createdAt DESC`). Le tri par « dernière activité » demanderait de joindre
   les tables de trois modules ; la bibliothèque d'un utilisateur est petite
   et mise en cache par le mobile, qui peut la trier lui-même.
7. **Pas de N+1** : pour une page de livres, une requête groupée par module
   (`document` : la page ; `conversion` : les conversions retenues et
   l'agrégat de leurs parties ; `library` : les positions).
8. Routes : `GET /v1/library`, `GET|PUT /v1/conversions/:id/position`.

## Conséquences

- Nouveau module `library` (table `reading_positions`, migration `0007`) ;
  `document` et `conversion` exportent chacun un service de lecture, consommé
  derrière un port de `library` (même modèle que `DocumentTextReader`).
- Le mobile envoie la position à chaque pause ou interruption, et toutes les
  ~30 s pendant la lecture : une ligne par conversion, mise à jour en place.
- Une position supprimée suit sa conversion (`ON DELETE CASCADE`).
- Le tri par activité, s'il devient nécessaire, demandera un modèle de
  lecture dédié (projection) — à décider par une nouvelle ADR.
