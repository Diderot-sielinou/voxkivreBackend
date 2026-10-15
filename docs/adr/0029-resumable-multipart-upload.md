# 0029. Import d'un PDF : envoi par morceaux (S3 multipart) repris après une coupure

- Statut : accepted
- Date : 2026-10-15
- Tags : `document`, `stockage`, `mobile`, `réseau`
- Complète : ADR-0007 (upload direct pré-signé), qui reste la règle pour
  les petits fichiers et les anciens clients.

## Contexte

- ADR-0007 : le mobile envoie le PDF en **un seul** `PUT` signé (taille et
  type signés), puis confirme. Sur le réseau camerounais, une coupure à
  90 % d'un PDF de 50 Mo oblige à tout renvoyer : coût en data, échecs en
  série sur une connexion instable.
- S3 sait recevoir un objet **par morceaux** (multipart) : chaque morceau a
  sa propre URL signée, S3 garde ceux qu'il a reçus, l'assemblage final
  (`CompleteMultipartUpload`) produit un seul objet. Contrainte S3 : un
  morceau fait **au moins 5 Mio**, sauf le dernier ; 10 000 morceaux au plus.
- La maquette mobile promet des morceaux de 512 Ko : impossible avec S3.
- Le bucket a déjà une règle « annuler un envoi multipart inachevé après
  1 jour » (`infra/modules/storage`).

## Décision

1. **Opt-in, au-delà d'un seuil** : `POST /v1/documents` accepte
   `multipart: true`. Si le fichier dépasse **5 Mio**, l'API ouvre un envoi
   multipart (`CreateMultipartUpload`) et répond `multipart: { partSize,
partCount }` au lieu de `upload` ; sinon (ou sans le drapeau : anciens
   clients) rien ne change. Morceaux de **5 Mio** : le minimum S3, donc la
   plus petite perte possible ; 50 Mo = 10 morceaux.
2. **L'`uploadId` ne quitte jamais l'API** : colonne `documents.upload_id`
   (nullable), lue par deux méthodes du dépôt, hors de l'entité `Document`.
3. **Une route pour démarrer et reprendre** :
   `POST /v1/documents/:id/upload-parts` lit chez S3 les morceaux **déjà
   reçus** (`ListParts`) — taille conforme au plan — et renvoie une URL `PUT`
   signée (taille exacte signée, 15 min) pour chaque morceau manquant. Après
   une coupure, le mobile rappelle la route et n'envoie que le reste. 409
   `DOCUMENT_UPLOAD_CONFLICT` si le document n'attend pas d'envoi multipart.
4. **Confirmation inchangée côté client** : `POST …/upload-confirmation`
   vérifie que tous les morceaux du plan sont là (sinon 422
   `INVALID_DOCUMENT_UPLOAD`, raison `missing`), assemble à partir de la
   liste lue chez S3 (le mobile n'a pas à lire les `ETag`), puis applique les
   contrôles existants (taille totale, signature `%PDF-`). Idempotente : un
   envoi déjà assemblé (`NoSuchUpload`) passe directement aux contrôles.
5. **Abandon** : la purge des imports non confirmés (24 h) annule aussi
   l'envoi multipart (`AbortMultipartUpload`) ; la règle du bucket (1 jour)
   reste le filet de sécurité.
6. **IAM** : le rôle de l'instance gagne `s3:ListMultipartUploadParts` et
   `s3:AbortMultipartUpload` (créer, envoyer et assembler relèvent déjà de
   `s3:PutObject`).

## Conséquences

- Une coupure fait perdre au plus 5 Mio (le morceau en cours).
- Trois appels de plus pour un gros fichier (ouvrir, URL des morceaux,
  assembler) : négligeables devant le transfert.
- Les morceaux reçus mais jamais assemblés sont facturés jusqu'à leur
  annulation (24 h par la purge, 1 jour par la règle du bucket).
