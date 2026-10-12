# 0024. OCR des PDF scannés : Tesseract dans l'API, par lots de 10 pages, validation imposée si la confiance est faible

- Statut : accepted
- Date : 2026-10-12
- Tags : `document`, `extraction`, `ocr`, `qualité`, `coût`, `capacité`
- Réalise : RF-04 (OCR + score de confiance par page) et la part « obligatoire
  si confiance faible » de RF-06. Précise ADR-0009 (un traitement CPU lourd
  dans le processus de l'API), ADR-0022 (le nettoyage reçoit les lignes de
  l'OCR) et ADR-0010/0019 (le quota reste compté sur le texte nettoyé).

## Contexte

- Un PDF dont le texte natif fait moins de 50 caractères par page en moyenne
  finit aujourd'hui en `extraction_failed` / `scanned`, PDF supprimé. Les
  cours et livres photocopiés sont courants au Cameroun.
- Le CdC (§11.2) et le SRS prévoient **Tesseract auto-hébergé**, avec un
  service cloud en repli si la qualité ne suffit pas.
- **Amazon Textract essayé le 2026-10-12** (`detect-document-text`,
  eu-west-3) : `SubscriptionRequiredException`. Le compte est au **plan
  gratuit** AWS (`accountPlanType: FREE`, crédits jusqu'au 2027-04-02) qui
  n'y donne pas accès ; passer au plan payant est irréversible. Google
  Vision est exclu (pas de compte Google possible, ADR-0013).
- **Banc d'essai sur l'instance de production** (t4g.small, 2 vCPU ARM,
  2 Go, crédits CPU `standard`), conteneur jetable `--cpus=1`, Tesseract
  5.3.0 `fra`, 10 pages A4 scannées à 200 dpi, ~2 000 caractères/page :

  | Mesure                                | Valeur                                                        |
  | ------------------------------------- | ------------------------------------------------------------- |
  | OCR                                   | **3,0 à 3,5 s/page** (3,1 s en moyenne)                       |
  | Rendu `pdftoppm -r 200 -gray -png`    | 5,6 s/page — l'encodage PNG, pas le rendu                     |
  | Même rendu en PGM brut (local)        | 0,064 s/page                                                  |
  | `/health` pendant l'OCR (164 mesures) | p50 22 ms, p95 29 ms, max 36 ms, 0 échec (repos : p50 21 ms)  |
  | CPU instance / crédits                | 54 % max sur 5 min / 576 → 575,96                             |
  | Erreurs (hors en-tête et numéro)      | **0,21 %** des mots (5 sur 3 850) ; confiance moyenne 94,5–96 |

  Limite : pages générées, propres ; une vraie photocopie fera moins bien.

## Options

1. **Tesseract dans le processus de l'API** (programme lancé en processus
   enfant, un seul à la fois) : 0 $ par page, aucune infrastructure
   nouvelle ; le calcul occupe un cœur sur deux.
2. Tesseract dans un conteneur `ocr-worker` séparé : même isolation CPU
   (le banc tournait déjà dans un conteneur à part), mais un point d'entrée,
   un service compose et des réglages de plus.
3. Textract (asynchrone, lit le PDF dans S3) : meilleure qualité, rien sur
   l'instance, ~0,0015 $/page — **indisponible** sans passer au plan payant.

## Décision

**Option 1**, derrière un port : passer à 2 ou 3 = un adapter et un réglage,
sans toucher au domaine ni aux use-cases (RNF-17).

1. **Port `OcrPort`** (`document/domain/ports`) :
   `recognizePages(pdf, firstPage, lastPage)` → pour chaque page, des lignes
   `{ text, top, fontSize }` (même forme que l'extraction native, ADR-0022) et une
   **confiance** de 0 à 1 (`null` pour une page sans mot). Adapter
   `TesseractOcrAdapter` (`infrastructure/ocr`) :
   - pages rendues par **`pdftoppm -r 200 -gray`** en PGM brut (jamais en
     PNG : l'encodage coûtait plus que l'OCR) ; tout PDF passe, quel que
     soit le codage de ses images (JPEG, JBIG2, CCITT) ;
   - `tesseract <image> - -l fra --psm 3 tsv`, `OMP_THREAD_LIMIT=1`, sous
     `nice` ; lancé par `execFile` (pas de shell, arguments fixes), délai
     maximal 60 s par page, dossier temporaire par lot supprimé en `finally` ;
   - lignes reconstituées depuis la sortie TSV (mots regroupés par ligne) :
     `top` = haut de la ligne / hauteur de page ; `fontSize` = hauteur de la
     ligne ramenée à une page A4 en points (le nettoyage ne compare que des
     tailles relatives au corps du texte) ;
   - confiance de page = moyenne des confiances des mots (les `-1` ignorés).
     Image : `tesseract-ocr`, `tesseract-ocr-data-fra`, `poppler-utils` (apk).
2. **Détection inchangée** (< 50 caractères/page en moyenne, sur le brut).
   Un scan ne part plus en échec : `documents.extraction_method = 'ocr'`, le
   statut reste `extracting`, le PDF reste dans S3 jusqu'à la fin.
3. **Garde-fous de coût et de charge** (D2), vérifiés avant le premier lot :
   - **300 pages** au plus par scan → `extraction_failed` /
     `ocr_too_many_pages` ;
   - **200 pages d'OCR par mois civil** pour un compte sans pass actif ni
     crédits (lu par un port vers `billing`) → `ocr_quota_exceeded`. Les
     pages se comptent sur les documents passés à l'OCR dans le mois.
4. **Lots de 10 pages**, file `document-ocr`, **concurrence 1** :
   - tâche `ocr-pages` `{ documentId, fromPage }`, `jobId` déterministe
     (`ocr-<document>-<fromPage>`) : un rejeu ne refait rien de plus ;
   - chaque lot relit le PDF dans S3 (≤ 50 Mo, même région : pas de frais),
     enregistre ses pages dans **`document_ocr_pages`** (lignes brutes +
     confiance, `upsert` par `(document_id, page_number)`), puis met le lot
     suivant **en fin de file** : plusieurs scans avancent **à tour de
     rôle**, un livre de 300 pages ne bloque pas un cours de 20 pages ;
   - le dernier lot assemble toutes les pages → nettoyage ADR-0022 →
     `completeExtraction` (texte nettoyé + confiance par page) → suppression
     des lignes brutes, puis du PDF. Pages et statut dans une transaction,
     comme aujourd'hui.
5. **Pannes** : 3 essais par lot ; échec final → `extraction_failed` /
   `internal`. Un balayage toutes les 5 min relance un OCR sans progrès
   depuis 10 min à partir de la première page manquante (`jobId` suffixé
   `-sweep-<minute>`, comme ADR-0011 : un `jobId` déjà terminé serait
   ignoré par BullMQ).
6. **Confiance et validation (RF-06)** : `document_pages.ocr_confidence`
   (nullable : `null` pour un PDF natif). **Seuil : 0,80** (D3, à ajuster sur
   de vrais scans). Une page sous le seuil → `documents.review_required`.
   Tant que la relecture n'est pas confirmée par
   `POST /v1/documents/:id/review` (enregistre `reviewed_at`, idempotent),
   le lancement d'une conversion répond **409 `DOCUMENT_REVIEW_REQUIRED`**.
   Pour un PDF natif, lancer la conversion vaut toujours validation.
7. **API** : le document expose `extractionMethod` (`native` | `ocr`),
   `ocrProgress` (`{ done, total }` pendant l'OCR), `reviewRequired`,
   `reviewedAt` ; chaque
   page expose `confidence`.
8. **Hors périmètre** (D4, D5) : PDF mixtes (la moyenne décide pour tout le
   document) ; OCR non facturé (le quota reste en caractères, sur le texte
   reconnu puis nettoyé) ; autres langues que le français.
9. Migration **`0014`** (ajouts seuls, compatible avec le code précédent) :
   `documents.extraction_method`, `ocr_page_count`, `review_required`,
   `reviewed_at` ; `document_pages.ocr_confidence` ; table
   `document_ocr_pages` (cascade sur `documents`).

## Capacité (calculée à partir du banc)

- Débit : ~3,3 s/page lecture S3 comprise → **~1 100 pages/heure**, soit
  ~16 000 pages par jour d'ouverture (instance allumée 8 h–23 h).
- Plusieurs scans en même temps se partagent ce débit à tour de rôle par
  lots de ~35 s. Exemples : 5 scans de 100 pages lancés ensemble → tous
  finis en ~28 min ; un cours de 20 pages derrière 5 gros scans → ~6 min
  au lieu de ~1 min seul.
- Crédits CPU : ~36 crédits nets par heure d'OCR continu ; le solde plein
  (576) couvre ~16 h d'affilée. Épuisé, l'instance ralentit (mode
  `standard`) sans surcoût.
- L'API garde un cœur : le reste du produit (lecture, synchronisation,
  bibliothèque) n'est pas freiné par l'OCR.

## Conséquences

- Image Docker plus lourde de **61,6 Mo** (mesuré) ; versions fixées par
  Alpine : Tesseract 5.5.2, poppler 25.12 (le banc tournait en 5.3.0 : la
  confiance moyenne d'un même scan passe de ~0,955 à ~0,92, le seuil 0,80
  reste à ajuster sur de vrais scans).
- Qualité moindre sur les mauvaises photocopies : c'est l'étape de
  validation qui protège l'utilisateur (et son quota).
- Le plafond mensuel compte les pages des documents passés à l'OCR **et
  encore présents** : supprimer un document rend ses pages. Accepté (l'OCR
  ne coûte que du CPU) ; un compteur séparé si l'abus apparaît.
- Nouvelles raisons d'échec : `ocr_too_many_pages`, `ocr_quota_exceeded`,
  `ocr_no_text` (aucun mot reconnu).
- La raison `scanned` n'est plus produite ; elle reste lisible pour les
  anciens documents.
- **Critères de révision** : attente moyenne d'un scan > 30 min aux heures
  chargées, ou p95 de l'API > 200 ms pendant l'OCR → option 2 (conteneur
  séparé ou instance plus grosse) ; qualité jugée insuffisante sur de vrais
  scans, ou passage du compte au plan payant → option 3 (Textract).
