# 0007. Stockage objet derrière un port, import de PDF par upload direct pré-signé

- Statut : accepted
- Date : 2026-10-06
- Tags : `stockage`, `api`, `mobile`, `sécurité`

## Contexte

RF-01 : l'utilisateur importe un PDF depuis son téléphone. DEC-04 / RF-18 /
RNF-10 : l'audio et le WebVTT générés seront conservés durablement côté
serveur. Le CdC §8 impose de supprimer le PDF source après conversion.
Trois modules toucheront au stockage : `document` (PDF), `conversion`
(audio, WebVTT), `library` (retéléchargement).

Contraintes propres à Voxlivre :

- **Réseau mobile camerounais instable et data chère** : un PDF de 20 Mo en
  3G peut mettre plusieurs minutes et échouer en route.
- **API sur Railway** : bande passante facturée, requêtes longues = risque de
  timeout et workers HTTP occupés.
- **Cloudflare R2** pressenti (SDD §3.3) : S3-compatible, sortie gratuite —
  important pour le retéléchargement de l'audio. Mais R2 **ne supporte pas
  les POST policies** (`content-length-range`) d'AWS S3.

## Options

1. **Upload direct pré-signé** : l'API signe une URL `PUT`, le mobile envoie
   le fichier directement au stockage, puis confirme ; l'API vérifie l'objet
   reçu.
2. **Multipart vers l'API** (`multipart/form-data` → API → stockage) : plus
   simple côté mobile, mais tous les octets traversent Railway, et une
   coupure réseau oblige à tout renvoyer à travers l'API.
3. **Adapter disque local en dev** (comme le KYC de cinaf-engine) : ne sait
   pas signer d'URL, et cinaf l'a vu casser en prod (système de fichiers du
   conteneur en lecture seule).

## Décision

**Option 1**, avec :

- **Port `ObjectStoragePort`** dans `src/shared/storage/` (capacité
  technique partagée, comme `shared/persistence`) : `presignPut`, `head`,
  `readRange`, `delete`. Les autres opérations (URL de téléchargement…)
  arriveront avec leur premier consommateur.
- **Un seul adapter S3-compatible** (`@aws-sdk/client-s3`) : R2 en prod,
  **RustFS** en local (docker-compose) et en tests d'intégration
  (Testcontainers). RustFS remplace MinIO, initialement prévu, parce que les
  images MinIO ne sont plus distribuées publiquement (Docker Hub refuse le
  pull, Quay exige une authentification).
- **Taille et type imposés par la signature** : `content-length` et
  `content-type` sont des en-têtes **signés** de l'URL `PUT`. Un envoi d'une
  autre taille ou d'un autre type est refusé par le stockage lui-même (403,
  vérifié en intégration). C'est notre substitut à la POST policy absente
  de R2.
- **Vérification à la confirmation** : `HEAD` (existence + taille exacte)
  puis lecture des 5 premiers octets (`%PDF-`). On ne fait jamais confiance
  à l'extension ni au type MIME déclarés. Fichier refusé → supprimé.
- **Clé déterministe** `documents/<ownerId>/<documentId>/source.pdf` : jamais
  de nom de fichier client (pas de path traversal, pas de donnée
  personnelle), un ré-upload écrase, le préfixe propriétaire permet de purger
  un compte.
- **Client S3 réglé pour le chemin de requête** : timeouts courts
  (2 s connexion, 5 s requête), 2 tentatives — même logique qu'ADR-0002.
  Checksums `WHEN_REQUIRED` : sinon le SDK ajoute un CRC32 aux URL
  pré-signées que le mobile devrait calculer.
- **Panne = 503** : `INFRASTRUCTURE_STORAGE_UNAVAILABLE` (RNF-11). Sans
  `S3_*` (dev, e2e), l'app boote et les routes concernées répondent
  `INFRASTRUCTURE_STORAGE_NOT_CONFIGURED` (503). `S3_*` est obligatoire en
  production (`PRODUCTION_RULES`).
- **Durées** (conventions produit, en constantes) : URL valable 15 min ;
  un document jamais confirmé est purgé après 24 h par un cron quotidien
  (03:00 UTC). La purge supprime la ligne **seulement si elle est encore**
  `awaiting_upload`, **puis** le fichier : une confirmation tardive gagne
  toujours la course.
- **Plafond** `DOCUMENT_MAX_SIZE_BYTES` (50 Mo par défaut).
- `/health/services` ne sonde **pas** le stockage (une requête facturée par
  sonde) ; une panne se voit aux 503 et dans les logs.

## Conséquences

- L'API ne transporte que du JSON ; le coût et la durée d'un import ne
  dépendent plus de Railway.
- Le mobile fait 3 appels au lieu d'un (créer, `PUT`, confirmer) et doit
  renvoyer les en-têtes signés tels quels.
- **Pas d'upload reprenable** : une coupure oblige à renvoyer tout le
  fichier (depuis le téléphone, pas via l'API). Un upload multipart
  pré-signé sera envisagé si les échecs deviennent un vrai problème.
- **En dev sur téléphone réel** : l'URL signée contient l'hôte de
  `S3_ENDPOINT`. `localhost:9002` n'est pas joignable depuis un téléphone ou
  l'émulateur Android : mettre l'IP LAN de la machine (ou `10.0.2.2` pour
  l'émulateur) dans `S3_ENDPOINT`.
- Plusieurs instances Railway lancent chacune la purge : sans risque
  (suppressions conditionnelles, idempotentes), pas de verrou au MVP.
- La suppression d'un compte supprime les lignes (`ON DELETE CASCADE`) mais
  pas encore les fichiers : à traiter avec la suppression de compte.
- Liens : `src/shared/storage/`, `src/modules/document/`,
  [testing-strategy.md](../code-engineering/testing-strategy.md).
