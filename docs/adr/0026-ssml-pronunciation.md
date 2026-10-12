# 0026. Pré-traitement de la prononciation : forme parlée en clair après chaque marque, jamais `<sub>`

- Statut : accepted
- Date : 2026-10-12
- Tags : `conversion`, `ssml`, `tts`, `qualité`
- Réalise : RF-07 (Should). Précise ADR-0008/0013 (une marque par mot) et
  ADR-0010 (quota sur le texte affiché).

## Contexte

- Le SSML envoyé à Polly est le texte affiché, mot par mot, chaque mot
  précédé d'une marque `<mark name="w<i>"/>` qui sert au surlignage
  (RF-10). Aucun pré-traitement : `2 500 FCFA`, `12/10/2026`, `art. 1108`,
  `M. Fouda`, `Chapitre IV`, `TVA` sont lus tels quels. Le découpage en
  mots coupe `2 500` en deux nombres.
- **Mesuré chez Polly le 2026-10-12** (voix standard Céline et neuronale
  Léa, marques `ssml` + `word`) : après un `<sub alias>`, les marques
  arrivent **en avance** — `w4` (« FCFA ») à 728 ms alors que le mot est
  dit à 1 367 ms, `w5` à 1 633 ms pour 2 065 ms. Le surlignage serait faux.
  Un alias vide est accepté et sa marque renvoyée.
- **Même texte, forme parlée écrite en clair après chaque marque** (sans
  `<sub>`) : chaque marque tombe exactement sur le mot dit ensuite, sur les
  deux moteurs (`w4@1343` → « francs »@1343, `w9@3506` → « mille »@3506).

## Décision

1. **Une marque par mot affiché, suivie de sa forme parlée en texte
   simple.** Le mot affiché (`SegmentWord.t`) et ses index ne changent pas ;
   seul le SSML change. Une forme parlée peut être **vide** (mot absorbé par
   le précédent : sa marque tombe au même instant que la suivante). Jamais
   de `<sub>` ni de `<say-as>` (même dérive probable).
2. **Où** : à la construction des segments (`conversion`), sur toute la
   suite des mots du document (le contexte d'un mot est son voisin). Le
   texte du document, ses pages et la validation sont inchangés.
3. **Règles**, dans cet ordre (une règle appliquée, le mot est pris) :
   1. **Chiffres romains** seulement après `chapitre`, `titre`, `livre`,
      `tome`, `partie`, `section` (`IV` → `4`) ou devant `siècle`
      (`XXe`, `XXIème`, `Ier` → `20e`, `21e`, `1er`).
   2. **Dates** `jj/mm/aaaa` valides (jour existant dans le mois), format
      français → `12 octobre 2026`.
   3. **Nombres groupés** : groupes séparés par espace ou espace insécable
      d'**exactement 3 chiffres** (`2 500`, `1 250 000` ; pas `1 2 500`),
      ou par des points s'il y a **au moins deux** points (`1.000.000` ;
      `1.000` reste tel quel, ambigu avec une décimale). Le premier mot
      porte le nombre entier en chiffres, les suivants une forme vide.
   4. **Montants** : `FCFA`, `XAF`, `F CFA` → `francs CFA` ; `€` →
      `euros` ; `$` → `dollars`.
   5. **Abréviations sûres** (sans ambiguïté) : `art.` article, `chap.`
      chapitre, `cf.` confer, `n°` numéro, `Mme` Madame, `Mlle`
      Mademoiselle, `Dr` Docteur, `Pr` Professeur, `éd.` édition, `vol.`
      volume, `ibid.` ibidem, `obs.` observations, `préc.` précité, `suiv.`
      suivants, `Cass.` Cassation, `civ.` civile, `op. cit.` opere citato,
      `loc. cit.` loco citato, `C. civ.` Code civil, `C. trav.` Code du
      travail, `C. pén.` Code pénal.
   6. **Abréviations ambiguës, seulement si le contexte tranche** (faux
      négatif préféré, comme RF-05) : `p.`/`pp.` + nombre → page(s) ;
      `al.` + nombre → alinéa ; `M.` + nom propre (majuscule) → Monsieur ;
      `t.` + nombre ou romain → tome. `et al.` n'est pas touché.
   7. **Sigles, liste explicite** avec leur mode :
      - épelés (lettres séparées) : TVA, PME, PIB, SARL, SAS, GIE, DGI,
        IRPP, RCCM, NIU, HT, TTC, SNCF, BTP, CCJA, AUDCG, AUSCGIE ;
      - lus comme un mot (casse de mot, `Ohada`) : OHADA, CEMAC, BEAC,
        UEMOA, OAPI, CNPS ;
      - développé : `JO` → Journal officiel.
        Aucun sigle hors liste n'est modifié.
   8. **Séparateur de tableau** `|` (ligne réintégrée, ADR-0025) → une
      virgule (pause), jamais lu.
      `supra`, `infra` sont du latin que Polly lit déjà : pas de règle (à
      confirmer à l'écoute).
4. **Découpage des phrases** : un mot reconnu comme abréviation (règles 5
   à 7, y compris une initiale `C.` d'un code) ne termine pas une phrase ;
   sa forme parlée n'a pas de point, donc pas de pause artificielle.
5. **Quota inchangé** : compté sur le texte affiché (ADR-0010).
6. **Cache** : le SSML change, donc l'empreinte ; les conversions déjà
   faites ne bougent pas, aucune migration.
7. **Vérification** : un texte de test contenant chaque cas, synthétisé
   avant/après sur une voix standard et une voix neuronale ; MP3 écoutés
   par le porteur ; marques comparées aux mots dits ; écarts entre moteurs
   signalés.

## Conséquences

- Le dictionnaire vit dans le code (versionné, testé) ; l'enrichir est un
  commit, pas une donnée d'exploitation.
- Mots étrangers et locutions latines générales : hors périmètre (pas de
  détection fiable de la langue d'un mot).
- Une règle fausse ne touche que la voix : le texte affiché reste exact.
