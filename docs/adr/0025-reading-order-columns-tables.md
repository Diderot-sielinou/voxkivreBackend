# 0025. Ordre de lecture et tableaux : faire confiance à l'ordre du PDF, filet pour les colonnes, tableaux mis de côté

- Statut : accepted
- Date : 2026-10-12
- Tags : `document`, `extraction`, `ocr`, `qualité`
- Réalise : RF-03 (Must, ordre logique de lecture, multi-colonnes) et la
  part « tableaux » de RF-05 (Must). Complète ADR-0022 (nettoyage) et
  ADR-0024 (l'OCR fournit les mêmes informations).

## Contexte

Mesuré le 2026-10-12 avec l'extracteur de production (pdf.js) :

| PDF                                                | Colonnes                                                             | Tableaux                                                                            |
| -------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Article LaTeX 2 colonnes (arXiv 1512.03385)        | bon ordre : pdf.js suit l'ordre d'écriture, colonne par colonne      | lus comme du texte (« ResNet 20 0.27M 8.75 »), police légèrement plus petite        |
| Polycopié LibreOffice (titre, 2 colonnes, tableau) | bon ordre, y compris un paragraphe qui passe d'une colonne à l'autre | lus ligne par ligne (« Nullité relative 5 ans 1304 »), **même police que le corps** |

- Les générateurs courants (LaTeX, Word, LibreOffice) écrivent le texte
  colonne par colonne : l'ordre du fichier est déjà le bon. Certains
  (magazines, zones de texte, journaux) écrivent ligne par ligne **en
  travers** des colonnes : pdf.js fusionne alors deux colonnes dans une
  ligne. Aucun exemple réel n'est disponible.
- Un tableau lu à voix haute est inintelligible et coûte du quota. La
  police ne le distingue pas toujours du corps ; sa **géométrie** le
  distingue : des cellules séparées par de grands espaces, alignées d'une
  ligne à l'autre.
- L'extracteur ne garde aujourd'hui que la position verticale et la taille
  de police d'une ligne (ADR-0022).

## Options

1. **Remettre chaque page en ordre géométrique** (colonnes détectées,
   blocs triés) : casse les PDF déjà justes au moindre faux positif — un
   tableau ressemble à des colonnes.
2. **Faire confiance à l'ordre du fichier**, avec un filet qui ne se
   déclenche que sur des lignes qui traversent une gouttière commune.

## Décision

**Option 2.**

1. **Segments horizontaux** : chaque ligne extraite porte ses segments
   `{ text, left, right }` (0 à 1 dans la largeur de la page), blocs de
   texte séparés par au moins **1 em** (la taille de la police). pdf.js :
   fragments du flux ; OCR : boîtes des mots de Tesseract (em ≈ hauteur
   médiane des mots). Champ facultatif : une ligne sans segments (anciens
   documents, tests) garde le comportement d'ADR-0022.
2. **Tableaux** (nouvelle raison `table`), avant les autres règles :
   - une ligne est **tabulaire** si elle a au moins 2 segments et des
     segments courts (≤ 25 caractères en moyenne : du texte en colonnes a
     des segments longs) ;
   - un tableau = au moins **3 lignes tabulaires consécutives**, dont une
     au moins a 3 segments, avec au moins **2 débuts de cellule alignés**
     (± 1,5 % de la largeur) sur 60 % des lignes ;
   - mis de côté ligne par ligne, cellules jointes par « | » pour que
     l'utilisateur puisse réintégrer une ligne à la validation ;
   - la légende « Tableau n : » l'est déjà (ADR-0022) ; le garde-fou de
     50 % s'applique (une page entièrement tableau reste lue).
3. **Colonnes, filet seulement** (après les tableaux, hors lignes de
   tableau) :
   - gouttière = la plus large bande verticale, dans le tiers central de
     la page, couverte par au plus 10 % des lignes **à plusieurs
     segments** (un titre pleine largeur ne la masque pas), d'au moins
     1,5 % de la largeur ;
   - la page est « en travers » si au moins 3 lignes, et 30 % des lignes,
     ont des segments **des deux côtés** de la gouttière ;
   - alors chaque ligne est coupée à la gouttière ; les parties gauches
     sont lues, puis les parties droites ; une ligne qui couvre la
     gouttière (titre pleine largeur) vide d'abord les deux colonnes
     accumulées.
     Sinon, la page est laissée telle quelle.
4. **Hors périmètre** : textes à l'intérieur des schémas (« relu »,
   « weight layer ») ; 3 colonnes et plus écrites en travers ; tableaux
   sans espaces (bordures seules) ; tableaux d'une seule colonne.
5. Anciens documents inchangés ; aucune migration (`set_aside` est un
   `jsonb`, la raison `table` s'y ajoute ; les lignes OCR en transit
   gardent les segments dans leur `jsonb`).

## Conséquences

- Le quota d'un document à tableaux baisse (le texte nettoyé est facturé,
  ADR-0022).
- Une ligne de texte courte et en colonnes (glossaire, sommaire en deux
  colonnes) peut être prise pour un tableau : elle reste visible dans
  `setAside` et réintégrable à la validation.
- Le filet n'a pas été vu en conditions réelles : il est testé sur un PDF
  fabriqué ligne par ligne en travers. Le premier vrai cas devra être
  ajouté aux tests.
