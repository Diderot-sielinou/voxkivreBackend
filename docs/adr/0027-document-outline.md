# 0027. Table des matières : signets du PDF d'abord, sinon titres détectés par la police

- Statut : accepted
- Date : 2026-10-12
- Tags : `document`, `extraction`, `navigation`
- Réalise : RF-12 (Should, navigation par table des matières). S'appuie sur
  ADR-0022 (taille du corps, lignes gardées), ADR-0024 (OCR) et ADR-0011
  (manifeste : pages → mots).

## Contexte

Mesuré le 2026-10-12 avec l'extracteur de production :

| PDF                              | Signets                                                                       | Titres par taille de police                                                                                                                                                                                                      |
| -------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Article LaTeX (arXiv 1512.03385) | aucun                                                                         | corps 10 pt ; sections 12 pt (« 1. Introduction », « References »), sous-sections 11 pt (« 3.1. Residual Learning ») : 18 titres, bonnes pages ; bruits : ligne des auteurs (12 pt, p. 1) et tampon vertical « arXiv:… » (20 pt) |
| Polycopié LibreOffice            | 1 (`[p.1] Droit des obligations — Chapitre 2`), créé depuis le style de titre | titre en 18 pt                                                                                                                                                                                                                   |

- Word et LibreOffice créent des signets à partir des styles de titre ;
  LaTeX sans `hyperref` configuré et les scans n'en ont pas.
- Le PDF est supprimé après l'extraction (CdC §8) : les signets doivent
  être lus pendant l'extraction.
- Le manifeste d'une conversion donne déjà les mots de chaque page
  (ADR-0011) : l'app sait trouver un mot dans une page.

## Décision

1. **Sources** : les **signets du PDF** (3 niveaux au plus, page résolue),
   sinon les **titres détectés**. Un signet sans page résoluble est ignoré ;
   une erreur de lecture des signets n'est pas un échec d'extraction.
2. **Titre détecté** : une ligne **gardée** par le nettoyage, non verticale,
   de 120 caractères au plus, d'au moins 3 lettres, dont la police fait au
   moins **1,08 × la taille du corps** (médiane pondérée du document). Les
   lignes candidates consécutives de même taille (± 0,25 pt) sont fusionnées
   (titre sur deux lignes). **Niveau** = rang de la taille parmi les titres
   (plus grand = 1), plafonné à 3.
3. **Titres à la taille du corps** (gras de Word, invisible ici) : seulement
   s'ils commencent par `Chapitre`, `Titre`, `Partie`, `Section`, `Leçon`,
   `Thème`, `Introduction` ou `Conclusion` (80 caractères au plus) ; niveau
   le plus bas. Une numérotation seule (`1.`, `1.2`) à la taille du corps
   n'est pas un titre (listes).
4. **Texte vertical** (tampon de marge) : l'extracteur le signale, il n'est
   jamais un titre. La ligne des auteurs d'un article peut rester (visible,
   sans effet sur la lecture).
5. **Stockage** : `documents.outline` (`jsonb`, migration `0015`, ajout
   seul), écrit avec les pages dans la transaction de fin d'extraction ;
   `null` pour un document d'avant (la route renvoie une liste vide).
6. **API** : `GET /v1/documents/:id/outline` → `{ items: [{ title, level,
pageNumber }], source: 'bookmarks' | 'headings' | null }` ; 409
   `DOCUMENT_TEXT_NOT_READY` avant le texte.
7. **Saut dans l'audio** : côté app, les mots du titre sont cherchés dans
   les mots de sa page (manifeste) ; à défaut, saut au début de la page.
   Une correction du texte ne modifie pas la table.
8. **OCR** : même détection (taille tirée de la hauteur des mots), pas de
   signets.

## Conséquences

- Pas de recalcul pour les anciens documents (pas de PDF pour le refaire).
- Un document sans titre plus grand que le corps ni mot-clé n'a pas de
  table : l'app propose alors la navigation par page.
- Faux positifs possibles (grand texte d'une figure, ligne d'auteurs) :
  inoffensifs, ils ne changent ni le texte lu ni le quota.
