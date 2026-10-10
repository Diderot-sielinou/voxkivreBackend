# 0019. Billing : pass de 30 jours, crédits, unités pondérées par la voix

- Statut : accepted
- Date : 2026-10-10
- Tags : `billing`, `conversion`, `coût`, `idempotence`, `paiement`
- Étend : ADR-0010 (réservation au lancement, remboursement à l'échec) — la
  limite unique « palier gratuit » devient trois sources. Répond à ADR-0013
  (« le quota ne distingue pas encore les voix »).

## Contexte

- RF-23 (Must) : accès payant par **abonnement et crédits** via Mobile Money.
  RF-24 : quota en caractères. DEC-08 / CdC §2.2–2.3 : modèle hybride, voix
  premium réservées au payant, tarif accessible aux étudiants. SDD : tables
  `subscriptions`, `wallets`, historique des recharges et consommations.
- Aujourd'hui `billing` ne connaît qu'un palier gratuit mensuel
  (`FREE_TIER_CHARS_PER_MONTH` = 100 000, toutes voix).
- Coût Polly réel (audio + marques, ADR-0013), à ≈ 600 FCFA le dollar :
  voix standard ≈ 4,8 FCFA / 1 000 caractères, voix naturelle ≈ 19 FCFA
  (×4). Un livre de 200 pages (~450 000 car.) coûte ≈ 2 200 FCFA en
  standard, ≈ 8 600 FCFA en naturelle. Un abonnement de 2 000 FCFA ne paie
  donc qu'environ un livre en standard.
- **Mobile Money ne prélève pas automatiquement** : chaque paiement est
  confirmé par le client sur son téléphone. Un « abonnement récurrent » au
  sens carte bancaire n'existe pas.
- Le paiement (`payment` : agrégateur, webhooks HMAC, réconciliation) est
  une étape ultérieure ; `billing` doit savoir **quoi accorder** quand un
  paiement réussit.

## Options

**Forme de l'abonnement** : (1) **pass de 30 jours** acheté et renouvelé par
un paiement ; (2) mois civil prélevé chaque mois — impossible en Mobile
Money.

**Coût des voix** : (1) **unités pondérées** (naturelle ×4) ; (2) même prix
pour toutes — perte sur chaque livre en voix naturelle ; (3) voix naturelles
interdites hors abonnement, sans pondération — un abonné en naturelle coûte
4 fois plus qu'en standard pour le même prix.

**Catalogue des prix** : (1) **table en base remplie par migration** ;
(2) constantes dans le code ou variables d'env — un redéploiement par prix.

## Décision

1. **Unité de compte** : l'**unité**. Une conversion coûte
   `caractères × poids de la voix` : **standard ×1, naturelle ×4**. Le poids
   est une propriété de la voix, fournie par `conversion` à la réservation
   (`tier: standard | natural`) ; `GET /v1/voices` expose la gamme de chaque
   voix, `GET /v1/billing/offers` les poids (le tarif appartient à `billing`).
2. **Trois sources**, débitées dans cet ordre (le plus périssable d'abord) :
   1. **palier gratuit** : `FREE_TIER_UNITS_PER_MONTH` (50 000) par mois
      civil UTC — **voix standard seulement** (CdC §2.3) ; une voix
      naturelle ne puise pas dans le gratuit ;
   2. **pass** : unités incluses dans le pass actif, perdues à son échéance ;
   3. **crédits** : solde du portefeuille, **sans expiration** (v1).

   Une conversion peut puiser dans plusieurs sources ; la réservation garde
   le détail par source. Total insuffisant → `QUOTA_EXCEEDED` (402), avec le
   détail disponible par source (rien n'est réservé).

3. **Pass de 30 jours** : chaque achat crée une période `[début, fin)`. Payer
   pendant un pass actif ajoute une période qui **commence à la fin** de la
   précédente (aucun jour perdu). Seule la période en cours est consommable.
   Pas de renouvellement automatique ; un rappel avant échéance viendra avec
   les notifications push.
4. **Remboursement** (ADR-0010 inchangé sur le montant : réservation moins
   les segments déjà synthétisés) : rendu **dans l'ordre inverse** du débit —
   crédits d'abord, puis pass, puis gratuit — puisque la part consommée est
   imputée aux premières sources. Une source expirée entre-temps (pass
   terminé, mois écoulé) garde ce qu'on lui rend, sans effet : cas rare, un
   échec survenant en quelques minutes.
5. **Plafond par conversion** (RNF-25) : inchangé, en **caractères**
   (`MAX_CHARS_PER_CONVERSION`) — il borne la taille d'un document ; le coût
   est couvert par le solde.
6. **Concurrence** : réservation et remboursement dans une seule transaction
   (celle de `conversion`, `UnitOfWork` réentrant), verrous pris toujours
   dans le même ordre (compteur gratuit → pass → portefeuille) : ni course
   entre deux lancements, ni interblocage. Solde et unités consommées
   protégés par des contraintes `CHECK` (jamais négatifs, jamais au-delà de
   l'inclus).
7. **Catalogue** : table `offers` (code, type `pass | credits`, prix en FCFA,
   unités, durée en jours pour un pass, actif) remplie **par migration**.
   Valeurs provisoires, à ajuster après l'étude de prix locale (CdC §5) sans
   toucher au code :

   | Offre     | Prix       | Unités  | Durée |
   | --------- | ---------- | ------- | ----- |
   | Pass      | 2 000 FCFA | 250 000 | 30 j  |
   | Crédits S | 500 FCFA   | 50 000  | —     |
   | Crédits M | 1 000 FCFA | 110 000 | —     |
   | Crédits L | 2 500 FCFA | 300 000 | —     |

   Une unité coûte ≈ 4,8 FCFA / 1 000 quelle que soit la voix (c'est
   l'effet de la pondération) : au pire, sans cache, le coût TTS va de 48 %
   (crédits S) à 60 % (pass) du prix, avant les frais Mobile Money
   (≈ 1,5 à 3,5 %). Un achat **recopie** prix et unités : changer le
   catalogue ne modifie jamais un achat passé.

8. **Montants** : value object `Money` en **FCFA (XAF), entier**, sans
   centimes ni virgule flottante.
9. **Frontière avec `payment`** : `billing` expose un use-case interne
   « accorder une offre », **idempotent par référence de paiement** (clé
   unique en base, RNF-09) : un paiement confirmé deux fois n'accorde qu'une
   fois. Aucune route d'achat dans `billing` ; en attendant `payment`, le
   use-case est exercé par les tests seulement.
10. **Historique** : `credit_entries`, journal en ajout seul (recharge +,
    consommation −, remboursement +), même transaction que le solde.
11. **API** : `GET /v1/billing/offers` (catalogue actif),
    `GET /v1/billing/account` (gratuit du mois, pass en cours et à venir,
    solde) — **remplace `GET /v1/quota`** (aucun client à ménager),
    `GET /v1/billing/wallet/entries` (paginé, curseur signé).

Hors périmètre : paiement Mobile Money et réconciliation (`payment`),
rappels d'expiration (push), lutte contre les comptes multiples (RNF-28),
vente sur iOS (Apple impose son paiement intégré pour du contenu numérique :
ADR dédiée avant de cibler iOS).

## Conséquences

- Le coût d'un utilisateur gratuit est borné à ≈ 240 FCFA par mois (50 000
  unités en voix standard), contre ≈ 1 900 FCFA possibles aujourd'hui.
- `conversion` transmet la gamme de la voix à la réservation ; son
  `QuotaPort` change de forme, pas de responsabilité. La **voix par défaut
  devient standard** (`fr-f2`) : sinon un nouvel utilisateur ne pourrait pas
  convertir sans payer.
- `FREE_TIER_CHARS_PER_MONTH` devient `FREE_TIER_UNITS_PER_MONTH` ; les
  réservations du mois en cours restent comptées comme unités du gratuit.
- Un prix change par une migration (revue, tracée), sans redéploiement de
  code applicatif au-delà de la migration.
- `payment` n'aura qu'à appeler « accorder une offre » après un paiement
  confirmé.
