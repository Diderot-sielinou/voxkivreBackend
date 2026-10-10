# 0016. Suppression d'un document : base dans une transaction, fichiers par outbox

- Statut : accepted
- Date : 2026-10-10
- Tags : `library`, `stockage`, `fiabilité`, `rgpd`
- Complète : ADR-0007 (stockage objet), ADR-0011 (fichiers d'une conversion).

## Contexte

RF-25 : supprimer un document de la bibliothèque, après une confirmation
explicite (côté mobile). Jusqu'ici aucune route ne le permettait, et les
fichiers produits (`conversions/<propriétaire>/<conversion>/*`, le PDF source
s'il n'a pas encore été supprimé) n'étaient jamais effacés.

Supprimer, c'est deux systèmes : PostgreSQL (lignes, en cascade : pages,
conversions, segments, parties, positions) et le stockage objet (jusqu'à
~160 fichiers pour un long livre). Ils ne partagent pas de transaction.

## Options

1. Effacer les fichiers **dans la requête**, puis les lignes : lent (jusqu'à
   160 appels), et une panne au milieu laisse un document à moitié détruit.
2. Lignes en transaction, puis **tâche BullMQ** portant les clés : si Redis
   tombe entre le commit et la mise en file, les fichiers restent pour
   toujours ; la charge d'une tâche n'est pas faite pour des listes longues.
3. **Outbox en base** : dans la **même transaction** que la suppression, on
   écrit les clés à effacer dans `pending_file_deletions` ; un balayage
   périodique efface les objets puis les lignes de l'outbox.

## Décision

**Option 3.**

1. `DELETE /v1/documents/:id` (module `library`) : dans une transaction,
   lecture des clés des fichiers (calculées par `conversion` et `document`,
   qui les connaissent), insertion dans l'outbox, suppression du document
   (cascade). Réponse 204. Atomique : soit tout est fait et les fichiers sont
   promis à l'effacement, soit rien.
2. **Refus 409 `DOCUMENT_DELETION_CONFLICT`** si une conversion du document
   est en cours (`queued` à `synthesized`) : on supprime après la fin ou
   l'échec. Annuler des tâches en vol serait bien plus complexe pour un cas
   rare.
3. **Balayage** chaque minute (`@nestjs/schedule`), par lots : `delete` de
   chaque clé (idempotent : un objet absent n'est pas une erreur), puis
   suppression de la ligne. Une panne du stockage laisse la ligne : réessai
   au passage suivant ; le nombre d'essais et la dernière erreur sont
   tracés. Plusieurs instances peuvent balayer en même temps sans risque.
4. **Le quota n'est pas remboursé** : les caractères ont été synthétisés et
   payés (ADR-0010).
5. **Le cache TTS partagé** (`tts-cache/`) n'est pas effacé : indexé par
   empreinte du texte et de la voix, partagé entre utilisateurs, sans donnée
   de compte. Sa purge (par ancienneté) reste à faire.
6. Supprimer un document absent ou à quelqu'un d'autre : 404 (RNF-08).
   La confirmation est un dialogue côté mobile ; l'API reste sûre si la
   requête est rejouée (404 la seconde fois).

## Conséquences

- Table `pending_file_deletions` (module `library`, migration `0007`) :
  réutilisable pour la suppression d'un compte (à venir).
- Les fichiers disparaissent en moins d'une minute en temps normal ; en cas
  de panne du stockage, dès son retour.
- Une ligne qui échoue sans fin se voit dans les logs (`attempts`,
  `lastError`) ; à surveiller dans les indicateurs d'exploitation (RNF-27).
