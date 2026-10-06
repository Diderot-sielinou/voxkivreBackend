# 0010. Quota en caractères : réservation au lancement, remboursement à l'échec, cache par segment

- Statut : accepted
- Date : 2026-10-06
- Tags : `billing`, `conversion`, `tts`, `coût`, `idempotence`

## Contexte

La synthèse vocale (sous-étape 2b) est le premier code qui coûte de
l'argent réel à chaque exécution (4 $ par million de caractères,
ADR-0008). Deux risques financiers :

- payer deux fois le même segment (relance de tâche, crash, double clic sur
  une connexion instable) — RNF-12 ;
- convertir un livre entier pour un utilisateur sans droits suffisants —
  RF-24, RNF-25 (« consume-quota refuse une conversion dépassant le
  plafond », SDD §4.1).

Les abonnements, crédits et paiements arrivent aux étapes `billing` et
`payment` ; il faut pourtant un vrai garde-fou dès maintenant.

## Options

1. **Débit segment par segment**, dans la transaction qui marque le segment
   synthétisé (ce que décrivait jobs-and-pipeline.md). Le plafond n'est connu
   qu'au fil de l'eau : une conversion peut s'arrêter à mi-livre faute de
   quota, et chaque segment exige une transaction partagée entre
   `conversion` et `billing`.
2. **Réservation du `charCount` du document au lancement**, dans la même
   transaction que la création de la conversion ; remboursement de la part
   non consommée si la conversion échoue.
3. Adaptateur de quota « illimité » jusqu'à l'étape `billing`.

## Décision

**Option 2**, avec un module `billing` minimal mais réel (l'option 3 lancerait
de vraies synthèses Google sans aucun plafond, même en test) :

- **Réservation** : `quota_usage (user_id, period)` est incrémenté par un seul
  `INSERT … ON CONFLICT DO UPDATE … WHERE reserved + n <= limite` : pas de
  course entre deux lancements simultanés. Chaque réservation est tracée dans
  `quota_reservations` (clé = identifiant de la conversion), ce qui rend le
  remboursement idempotent.
- **Atomicité entre modules** : la conversion et la réservation sont écrites
  dans **une** transaction. `billing` ouvre sa propre transaction via le
  `UnitOfWork` réentrant, qui rejoint celle de `conversion` (savepoint sur la
  même connexion) — aucun module n'importe l'adapter de l'autre : `conversion`
  dépend de son `QuotaPort`, implémenté par un adapter qui appelle les
  use-cases exportés par `billing`.
- **Limites** (configurables, valeurs de départ en attendant l'étude de prix,
  SDD §13.1) : `FREE_TIER_CHARS_PER_MONTH = 100 000` par mois civil UTC,
  `MAX_CHARS_PER_CONVERSION = 1 000 000`. Dépassement mensuel →
  `QUOTA_EXCEEDED` (402) ; dépassement du plafond par conversion →
  `QUOTA_CONVERSION_LIMIT_EXCEEDED` (422 : payer ne changerait rien).
- **Remboursement** : une conversion qui échoue (essais épuisés, requête
  refusée par le fournisseur, texte modifié avant la préparation, document
  supprimé) rend la réservation moins les caractères des segments déjà
  synthétisés. Une conversion réussie ne rend rien.
- **Idempotence fonctionnelle** : une conversion active (non échouée) est
  unique par `(document, voix, révision du texte)` — index unique partiel. Un
  double lancement renvoie la conversion existante sans nouveau débit ; pas
  d'en-tête `Idempotency-Key` ni de table dédiée. Corriger le texte crée une
  nouvelle révision, donc une nouvelle conversion, débitée.
- **Cache par segment** (RNF-26) : clé = SHA-256(signature du moteur + SSML),
  objets `tts-cache/<empreinte>.mp3` + `.json` (marques, durée). Les marques
  sont numérotées **localement** au segment, et les frontières de segments
  dépendent du contenu des phrases (pas de leur position) : une correction ne
  change que les segments voisins. Le cache économise le coût Google pour
  Voxlivre, y compris entre utilisateurs (même cours importé par plusieurs
  étudiants) ; l'utilisateur est débité quand même (prix du service, et rien
  n'est révélé sur les autres utilisateurs).
- **Synthèse toujours à la vitesse 1.0** : la vitesse de lecture (RF-22, 0,5×
  à 2×) est appliquée par le lecteur mobile. Une génération par vitesse
  coûterait autant de fois plus et casserait le cache.

## Conséquences

- Le plafond est vérifié **avant** toute dépense, en une requête SQL.
- Une conversion lancée est toujours menée au bout ou remboursée : jamais de
  livre à moitié converti faute de quota.
- La synthèse elle-même ne touche plus au quota : pas de transaction entre
  modules par segment, et le fournisseur est appelé hors transaction.
- Le texte peut changer entre le lancement et la préparation (fenêtre de
  quelques secondes) : la préparation compare la révision et, si elle a
  changé, échoue avec `text_changed` et rembourse tout.
- Les étapes `billing` (abonnement, crédits) et `payment` enrichiront le
  calcul de la limite derrière les mêmes use-cases, sans changer
  `conversion`.
- Liens : [jobs-and-pipeline.md](../code-engineering/jobs-and-pipeline.md),
  ADR-0008, ADR-0009, `src/modules/billing/`, `src/modules/conversion/`.
