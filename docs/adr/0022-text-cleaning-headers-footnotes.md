# 0022. Nettoyage du texte : en-têtes et pieds répétés, numéros de page, notes, légendes

- Statut : accepted
- Date : 2026-10-11
- Tags : `document`, `extraction`, `qualité`, `facturation`
- Réalise : RF-05 (Must). Prépare RF-03 (multi-colonnes) et RF-04 (OCR).
  Précise ADR-0010 et ADR-0019 : le quota se compte sur le texte nettoyé.

## Contexte

- RF-05 : « nettoyer automatiquement le texte (suppression des
  en-têtes/pieds de page répétés détectés par analyse de fréquence, mise à
  l'écart des notes de bas de page, des tableaux et des légendes,
  recomposition des mots coupés en fin de ligne) ». Le SDD place ce
  nettoyage entre l'extraction et la validation (RF-06).
- Aujourd'hui, seuls les espaces, les lignes vides et les mots coupés sont
  traités. L'extracteur (pdf.js) rend des lignes **sans position ni taille
  de police**.
- Le découpage SSML ignore les sauts de ligne et coupe sur la ponctuation :
  un en-tête, un numéro de page ou une note est lu **au milieu de la phrase**
  qui chevauche deux pages, et ce à chaque page.
- Le quota est compté sur le texte extrait : l'utilisateur paie ces lignes.
- **Le PDF est supprimé après l'extraction** (CdC §8) : ce qui est retiré du
  texte ne peut plus être retrouvé dans la source.

## Options

1. **Règles déterministes à l'extraction**, à partir des lignes, de leur
   position verticale et de leur taille de police.
2. Nettoyage au moment de la conversion : l'écran de validation montrerait un
   texte différent de celui qui est lu et facturé.
3. Modèle d'apprentissage (classification de lignes) : coût, dépendance,
   résultats non explicables ; disproportionné pour ces motifs réguliers.

## Décision

**Option 1, dans le domaine de `document`, appliquée à l'extraction.**

1. **Lignes enrichies** : l'extracteur fournit pour chaque ligne son texte,
   sa position verticale (`top`, de 0 en haut à 1 en bas de la page) et sa
   taille de police (celle du fragment le plus long). Base aussi de RF-03 et
   RF-04.
2. **Zones de marge** : les 10 % du haut et du bas de la page.
3. **Numéros de page** : une ligne de marge de la forme `12`, `- 12 -`,
   `Page 12`, `p. 12`, `12/300`, `12 sur 300` ou un chiffre romain **d'au
   moins deux caractères** (`ii`, `xiv`) est retirée (`page_number`). Une
   lettre seule (`m`, `v`) reste du contenu : livre d'apprentissage des
   lettres.
4. **En-têtes et pieds répétés** (`header`, `footer`) : empreinte d'une
   ligne = minuscules, chiffres remplacés par `#`, ponctuation et espaces
   retirés. Une ligne de marge est retirée si son empreinte apparaît en
   marge sur **au moins 3 pages d'une fenêtre de 6 pages consécutives** :
   couvre les en-têtes alternés (pages paires et impaires) et ceux qui
   changent à chaque chapitre. Exception : un en-tête **au moins 15 % plus
   grand que le corps** est un titre (histoire d'un livre de lecture,
   diaporama) ; sa première occurrence de chaque série est gardée, les
   répétitions sont retirées.
5. **Notes de bas de page** (`footnote`) : un bloc n'est retiré que si
   (a) sa première ligne, dans la moitié basse et en police **au moins 15 %
   plus petite** que le corps (taille médiane pondérée par les caractères),
   commence par un appel (`1`, `¹`, `*`, `†`) ; (b) il va **jusqu'en bas de
   la page** : aucune ligne de taille normale en dessous, jugé par la
   position (pdf.js ne rend pas toujours les lignes dans l'ordre vertical) ;
   (c) son appel figure dans le corps de la page **collé à un mot**
   (« hasher1 », « droit² »). Un titre d'exercice numéroté en petite police
   n'est donc pas une note. Les appels de note dans le corps sont gardés.
6. **Légendes** (`caption`) : ligne de moins de 200 caractères commençant par
   `Figure n`, `Fig. n`, `Tableau n`, `Graphique n`, `Schéma n`, `Photo n`
   ou `Source :`. Les **tableaux** attendent les positions horizontales
   (RF-03).
7. **Garde-fou** : une page dont le nettoyage retirerait plus de 50 % des
   caractères est laissée intacte (diaporama au titre répété, page de garde).
8. **Rien n'est perdu** : les lignes retirées sont conservées par page avec
   leur motif dans `document_pages.set_aside` (jsonb, jamais requêté) et
   renvoyées par `GET /v1/documents/:id/pages` (`setAside`). L'écran de
   validation peut les montrer ; l'utilisateur en réintègre une en
   corrigeant le texte de la page (RF-06).
9. **Facturation** : `char_count` est compté sur le texte nettoyé (on ne
   paie que ce qui est lu). La détection des PDF scannés reste calculée sur
   le texte **brut**.
10. **Documents déjà importés** : inchangés (PDF supprimé, conversions liées
    aux positions des mots). Le nettoyage vaut pour les nouveaux imports.

Hors périmètre : colonnes et tableaux (RF-03), OCR (RF-04), pauses aux
titres et paragraphes (RF-07), appels de note dans le corps.

## Conséquences

- Migration `0012` : colonne `set_aside jsonb` sur `document_pages`
  (nullable, ajout seul : compatible avec la version précédente du code).
- Le port d'extraction rend des lignes avec position et taille de police ;
  un futur adapter OCR devra fournir les mêmes informations.
- Un faux positif reste possible (une phrase courte répétée en marge sur 3
  pages proches) : il est visible dans `setAside` et réparable à la
  validation ; le garde-fou limite les dégâts sur une page.
- Une modification de la page par l'utilisateur ne touche pas `set_aside`.

## Vérifié en réel (2026-10-11)

Quatre PDF réels (cours de droit, recueil de lectures en droit, cours de
programmation, livre de lecture de 2e année), par l'extracteur et le
nettoyage compilés :

| Document                      | Pages | Retiré | Détail                                                               |
| ----------------------------- | ----- | ------ | -------------------------------------------------------------------- |
| Cours de programmation        | 48    | 2,5 %  | 46 numéros de page, 37 en-têtes de chapitre, 7 vraies notes          |
| Livre de lecture              | 109   | 8,8 %  | 126 pieds répétés, 77 en-têtes (titre d'histoire lu une fois)        |
| Cours d'introduction au droit | 77    | 0,04 % | 77 numéros de page ; pas d'en-tête ni de note dans ce document       |
| Recueil de lectures en droit  | 60    | 0 %    | ni en-tête courant ni note en bas de page (notes en fin de document) |

La première version prenait 61 lignes d'exercices du livre de lecture pour
des notes (titres numérotés en 11 pt pour un corps en 13 pt) et deux lettres
seules (`m`, `v`) pour des numéros de page : d'où les conditions (b) et (c)
du §5, la règle des chiffres romains du §3 et l'exception des titres du §4.

Limites constatées, hors périmètre : appels de note lus dans le corps
(« la Banque mondiale 219 »), ordre de lecture d'une mise en page
complexe (RF-03), numéros de ligne des extraits de code.
