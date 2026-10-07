# 0011. Assemblage d'une conversion : parties MP3 concaténées, WebVTT au mot, manifeste versionné

- Statut : accepted
- Date : 2026-10-07
- Tags : `conversion`, `mobile`, `hors-ligne`, `contrat`

## Contexte

La synthèse (2b) produit un MP3 et des horodatages par segment (~1 min
d'audio, ~1 000 caractères) : plusieurs centaines par livre. ADR-0008 a
décidé de livrer au mobile des **parties d'environ 10 minutes**, chacune
avec son WebVTT, plus un manifeste. Restait à fixer comment les fabriquer
sans FFmpeg (DEC-01), quand, et le **format** — un contrat avec
l'application Flutter, coûteux à changer une fois publiée.

Exigences : surlignage au mot sans décalage (RF-10, RNF-02), lecture hors
ligne (RF-13/14), aperçu en quelques secondes (RF-15, RNF-03), intégrité et
retéléchargement sans nouvelle synthèse (RF-17/18).

## Décision

1. **Plan des parties fixé à la préparation**, sur les caractères des
   segments : partie 1 ≈ 1 800 caractères (~2 min, l'aperçu), puis
   ≈ 9 000 caractères (~10 min). Une partie se termine toujours sur une
   frontière de segment. Chaque segment connaît sa partie et l'index global
   de son premier mot.
2. **Assemblage au fil de l'eau** : dès que tous les segments d'une partie
   sont synthétisés, une tâche `assemble-part` la construit — sans attendre
   la fin du livre. La dernière partie assemblée écrit le manifeste et fait
   passer la conversion en `ready`.
3. **Concaténation des trames MP3, sans réencodage** : un MP3 est une suite
   de trames indépendantes ; les étiquettes ID3 sont retirées. Les durées
   viennent du décompte des trames : les décalages de la partie sont exacts.
4. **WebVTT au mot** : un repère par mot, identifiant = index global du mot,
   texte = le mot, instants relatifs au début de la partie. Fin d'un mot =
   début du suivant (fin du segment pour le dernier) ; un horodatage
   manquant est interpolé entre ses voisins.
5. **Manifeste JSON, `version: 1`** : par partie, durée, début absolu,
   premier mot, nombre de mots, pages qui y commencent (page → premier mot),
   et pour chaque fichier sa taille et son SHA-256. Une copie est écrite
   dans le stockage objet (`manifest.json`, copie durable autonome, RF-18) ;
   l'API le sert depuis la base avec des **URL de téléchargement signées**
   valables 1 h (`GET /v1/conversions/:id/manifest`), dès la première partie
   (`complete: false`).
6. **Un assemblage raté ne fait jamais échouer la conversion** : la synthèse
   est payée et l'assemblage est déterministe ; le balayage le relance.
7. Fichiers rangés sous `conversions/<utilisateur>/<conversion>/` : la
   purge d'un compte supprime tout d'un préfixe.

## Conséquences

- Le mobile télécharge et reprend partie par partie ; il vérifie chaque
  fichier par son SHA-256 (contrôle d'intégrité de la bibliothèque, RF-17).
- Un changement incompatible du manifeste = `version: 2`, le mobile
  refusant une version inconnue.
- L'audio existe deux fois dans le stockage (segments en cache + parties) :
  quelques millièmes de dollar par livre et par mois ; une politique de
  nettoyage du cache viendra plus tard.
- **À vérifier sur l'audio Google** : une trame d'en-tête « Xing » en tête
  de chaque segment, si elle existe, resterait au milieu d'une partie
  (~24 ms de silence par segment, décalage cumulé du surlignage). À retirer
  si l'essai réel la révèle.
- La table des matières (RF-12) attend l'extraction de la structure ; la
  correspondance page → mot couvre déjà « aller à la page ».
- Liens : ADR-0008, ADR-0010, [jobs-and-pipeline.md](../code-engineering/jobs-and-pipeline.md).
