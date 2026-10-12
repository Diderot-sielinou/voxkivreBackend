# 0028. Marque-pages : ancrés au texte du document, fusionnés par identifiant, jamais perdus

- Statut : accepted
- Date : 2026-10-12
- Tags : `library`, `mobile`, `multi-appareils`, `rgpd`
- Réalise : RF-27 (Should, marque-pages avec note). Complète ADR-0015
  (position), ADR-0011 (manifeste : `pageStarts`), ADR-0023 (suppression
  de compte).

## Contexte

- La **position** de lecture (ADR-0015) appartient à une conversion et se
  perd volontairement quand le texte ou la voix change ; une seule valeur,
  « le plus récent gagne ».
- Un **marque-page** porte une note de l'utilisateur : le perdre parce
  qu'il a changé de voix ou corrigé une page serait inacceptable. C'est une
  **collection**, créée hors ligne sur plusieurs appareils.
- Le manifeste d'une conversion donne, pour chaque page, l'index global de
  son premier mot (`pageStarts`) ; l'identifiant d'un repère WebVTT est cet
  index global. Le découpage en mots de la conversion est celui du texte des
  pages (espaces).

## Décision

1. **Ancrage au document, jamais à une conversion.** Un marque-page stocke
   la **page**, l'**index du mot dans la page** (0 = premier mot), un
   **extrait** (jusqu'à 6 mots à partir de l'ancrage, calculé par le serveur
   sur le texte courant) et la **note**. Il ne stocke **pas** de temps audio.
   À la lecture, l'app calcule l'index global `pageStart(page) + index` dans
   la conversion en cours et s'y place grâce au WebVTT.
2. **Synchronisation par identifiant.** L'identifiant (UUID) est créé par
   l'appareil, hors ligne. `PUT` est idempotent : il crée le marque-page ou
   met à jour sa note. « Le plus récent gagne » s'applique **marque-page par
   marque-page**, selon `updatedAt` fourni par l'appareil (instant de la
   modification ; 5 min de tolérance de dérive, comme ADR-0015). Deux
   appareils qui créent chacun un marque-page en obtiennent deux.
3. **Suppression conservée comme trace** (`deleted_at`, avec l'instant de
   l'appareil) : une modification plus ancienne que la suppression ne fait
   pas réapparaître le marque-page ; plus récente, elle le rétablit. La
   réponse d'un `PUT` rend l'état retenu (y compris `deletedAt`) pour que
   l'appareil s'aligne.
4. **Texte modifié après la création** (correction, ligne de tableau
   réintégrée) : à chaque lecture, l'ancrage est vérifié sur le texte
   courant — l'extrait est-il à l'index ? sinon, l'extrait est cherché dans
   la page (occurrence la plus proche de l'ancien index) ; introuvable, le
   marque-page est placé au mot le plus proche de l'ancien index et rendu
   avec `needsReview: true`. **Jamais supprimé** pour un ancrage incertain.
   L'ancrage stocké n'est pas réécrit par une lecture.
5. **Données personnelles** : table `bookmarks`, clés étrangères en
   `ON DELETE CASCADE` vers `documents` et `user` : la suppression d'un
   document ou du compte (ADR-0023, même transaction) emporte les
   marque-pages et les traces. Notes jamais journalisées.
6. **Limites (validées par le porteur le 2026-10-12)** : **500** marque-pages par document (traces de
   suppression non comprises) → 409 `BOOKMARKS_LIMIT_CONFLICT` ; note de
   **2 000 caractères** → 422 `INVALID_BOOKMARK_NOTE` ; page inexistante ou
   index hors de la page → 422 `INVALID_BOOKMARK_ANCHOR` ; document pas
   `text_ready` → 409 `DOCUMENT_TEXT_NOT_READY`. Jamais 500.
7. **API** (style `/v1/documents`) :
   - `GET /v1/documents/:id/bookmarks` : marque-pages actifs, triés par
     page puis mot ; chacun `{ id, pageNumber, wordIndex, excerpt, note,
needsReview, createdAt, updatedAt }` (ancrage vérifié, §4) ;
   - `PUT /v1/documents/:id/bookmarks/:bookmarkId` `{ pageNumber,
wordIndex, note, updatedAt }` : crée (201) ou met à jour la note (200).
     L'ancrage est fixé à la création ; un autre ancrage pour un
     identifiant existant est ignoré ;
   - `DELETE /v1/documents/:id/bookmarks/:bookmarkId?deletedAt=<ISO>` :
     trace de suppression (204, idempotent ; identifiant inconnu : 204).
8. **Hors périmètre** : partage, export, recherche dans les notes,
   synchronisation incrémentale (`since`).
9. Migration **`0016`** : table `bookmarks` (`id` uuid, `owner_id`,
   `document_id`, `page_number`, `word_index`, `excerpt`, `note`,
   `created_at`, `updated_at`, `deleted_at`), index
   `(document_id, owner_id)`.

## Relation avec ADR-0015

Pas de contradiction : deux objets, deux règles. La position (valeur
unique, liée à une conversion) se perd quand le texte change ; le
marque-page (collection, liée au texte du document) survit et se signale
« à vérifier ». « Le plus récent gagne » vaut pour la position entière d'un
côté, pour chaque marque-page de l'autre.

## Conséquences

- La lecture d'une liste coûte une lecture des pages concernées (une
  requête par document, pas par marque-page).
- Les traces de suppression restent tant que le document existe (lignes
  minuscules) ; pas de purge.
