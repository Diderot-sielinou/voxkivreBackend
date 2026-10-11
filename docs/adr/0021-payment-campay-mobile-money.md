# 0021. Module payment : Mobile Money par Campay, état reconfirmé, réconciliation par balayage

- Statut : accepted
- Date : 2026-10-11
- Tags : `payment`, `billing`, `idempotence`, `sécurité`, `données personnelles`
- Réalise : ADR-0019 §9 (« `payment` n'aura qu'à appeler accorder une
  offre »). Modifie `api-design.md` (idempotence des webhooks par
  identifiant d'événement, signature HMAC sur `rawBody`) pour ce fournisseur.

## Contexte

- RF-23 (Must) : pass et crédits payés par **Orange Money et MTN MoMo**.
  RNF-09 : une notification de paiement n'est jamais comptée deux fois.
  RNF-13 : réconciliation des paiements en attente, échoués ou en double.
  RNF-17 : changer de prestataire = un nouvel adapter. RNF-27 : taux de
  réconciliation suivi. Le SDD prévoit `payment/campay.adapter.ts`.
- `billing` sait déjà accorder une offre, idempotent par référence de
  paiement (`GrantOfferUseCase`, clé primaire de `purchases`, ADR-0019).
- Un paiement Mobile Money est **asynchrone** : l'API demande l'encaissement,
  l'opérateur envoie un message au téléphone, le client tape son code PIN
  (ou pas) ; le résultat arrive plus tard.
- **L'instance est arrêtée de 23 h à 8 h** (ADR-0012) : une notification
  envoyée pendant la nuit tombe sur une API éteinte.
- API Campay, relevée dans sa documentation officielle (Postman) le
  2026-10-11 :
  - `POST /api/collect/` {amount entier, currency XAF, from `2376…`,
    description, external_reference} → {reference, ussd_code, operator},
    statut `PENDING`. **Idempotent sur `external_reference`**, qui doit être
    un UUID version 4 ;
  - `GET /api/transaction/{reference}/` → `PENDING | SUCCESSFUL | FAILED`,
    montant (décimal, ex. `2.0`), opérateur, `external_reference` ;
  - authentification : jeton permanent (`Authorization: Token …`) ou jeton
    temporaire d'une heure obtenu par nom d'utilisateur et mot de passe ;
  - notification (GET ou POST JSON, au choix dans l'application) envoyée
    pour `SUCCESSFUL` ou `FAILED`, avec un champ `signature` = **JWT HS256
    signé par la « clé webhook » de l'application**. La documentation ne dit
    pas ce que contient ce jeton, ni s'il est lié à la transaction ;
  - erreurs : `ER101` numéro invalide, `ER102` opérateur autre que MTN ou
    Orange, `ER201` montant invalide ;
  - environnement de test `demo.campay.net`, production `www.campay.net`.

## Options

**Prestataire**

1. **Campay** : API JSON, demande envoyée directement sur le téléphone (pas
   de page web), API de statut, environnement de test en libre accès.
2. Monetbil : widget qui redirige vers une page de paiement (WebView dans
   l'app), signature MD5 ; utilisé par cinaf sans API de statut.
3. Smobilpay (Maviance) : intégration plus lourde, contrat d'entreprise.

**Confiance dans la notification**

1. **Signal seulement** : la notification déclenche une nouvelle lecture de
   l'état chez Campay, avec nos identifiants ; seul cet état fait foi.
2. Contenu de la notification cru sur signature : tout reposerait sur un
   jeton dont on ignore le contenu exact.

**Traitement de la notification**

1. **Pendant la requête** : une lecture chez Campay et une transaction.
2. File BullMQ par fournisseur (cinaf, ADR-0098) : utile à fort volume.

## Décision

**Campay, notification = signal, état reconfirmé, réconciliation par
balayage, dans un nouveau module `payment`.**

1. **Module `payment`** : port `PaymentGatewayPort` (`collect`,
   `getTransaction`, `verifyNotification`) ; adapters `CampayGateway`,
   `FakeGateway` et `DisabledGateway`. Choix par
   `PAYMENT_PROVIDER=disabled|fake|campay` (défaut `fake`). Un autre
   prestataire = un adapter de plus (RNF-17).
2. **Parcours** :
   1. `POST /v1/payments` {offerCode, phoneNumber} + en-tête
      **`Idempotency-Key`** (obligatoire) → paiement `pending`, prix
      **recopié du catalogue** (jamais fourni par le client), demande
      d'encaissement → **202** {id, status, offerCode, amountXaf,
      phoneSuffix} ;
   2. l'utilisateur confirme sur son téléphone ;
   3. Campay notifie `POST /v1/webhooks/campay` ; l'API relit l'état
      (`GET /transaction/{reference}`) et le traite ;
   4. l'app interroge `GET /v1/payments/:id` (toutes les 3 s environ) ; la
      route lit la base seulement, sans appel à Campay.
3. **Notification** (option 1) : JWT `signature` vérifié en HS256 avec
   `CAMPAY_WEBHOOK_KEY` (en-tête `alg` imposé, comparaison en temps
   constant, `exp` respecté s'il est présent), puis **état relu chez
   Campay** et contrôle que son `external_reference` est bien le nôtre.
   Une notification forgée ou rejouée ne peut que déclencher une
   vérification. Réponses : signature absente ou invalide → 401 ; paiement
   inconnu → 200 (ignoré, `warn`), pour que Campay ne réessaie pas ; Campay
   injoignable pendant la relecture → 503, pour qu'il réessaie. Notification
   reçue en **POST** : en GET, signature et références apparaîtraient dans
   les URL, donc dans d'éventuels journaux d'accès. Corps jamais journalisé
   (il contient le numéro).
4. **Contrôle du montant** : l'offre n'est accordée que si le montant relu
   (converti en entier, sans arrondi) est **égal** au prix recopié et la
   devise `XAF`. Sinon : statut `amount_mismatch`, rien d'accordé, `error`
   dans les journaux, examen à la main.
5. **Machine à états** : `pending → succeeded | failed | expired |
amount_mismatch`. Les transitions sont conditionnelles en base
   (`UPDATE … WHERE status = 'pending'`) : notification et balayage peuvent
   arriver ensemble. Exception unique : **`expired → succeeded`**, si
   Campay confirme plus tard un paiement abandonné par le balayage (le
   client a été débité, il doit recevoir son offre). `failed → succeeded`
   n'est jamais appliqué automatiquement : `error` dans les journaux.
6. **Accord de l'offre** : `payment` dépend d'un port `BillingPort`
   (`findOffer`, `grant`) branché sur les use-cases de `billing`, comme
   `conversion` avec `QuotaPort`. Passage en `succeeded` et accord dans **la
   même transaction** (`UnitOfWork` réentrant). Référence de paiement
   transmise à `billing` = **`id` du paiement**.
7. **Idempotence, en quatre couches** (RNF-09) :
   1. `Idempotency-Key` unique par utilisateur : même clé et même requête →
      même paiement, sans nouvelle demande au téléphone ; même clé et
      requête différente → 409 ;
   2. `external_reference` (UUID v4, colonne dédiée) : renvoyer la demande à
      Campay après une coupure redonne la même transaction ;
   3. transitions conditionnelles (§5) ;
   4. `purchases` : une référence n'est jamais accordée deux fois.

   Pas de table de dédoublonnage des notifications (cinaf, ADR-0057) :
   traiter deux fois la même notification ne change rien.

8. **Réponse incertaine de Campay** (délai dépassé à la demande
   d'encaissement) : le paiement reste `pending` sans référence Campay, la
   route répond 503. Un nouvel essai avec la même `Idempotency-Key` renvoie
   la demande avec le même `external_reference` (sans double débit). Une
   notification arrivée entre-temps est retrouvée par `external_reference`.
9. **Réconciliation** (RNF-13) : tâche `@Cron` toutes les **5 minutes**.
   Elle relit chez Campay chaque paiement `pending` de plus de 2 minutes qui
   a une référence et le traite comme une notification. Sans réponse
   définitive au bout de **24 h** (ou sans référence Campay au bout de
   15 min) → `expired`. Chaque paiement retient par quel chemin il a été
   conclu (`confirmed_via` : `webhook | sweep`), ce qui donne le taux de
   réconciliation (RNF-27). Le premier balayage après le démarrage de 8 h
   rattrape les paiements de la nuit.
10. **Anti-abus** : on pourrait saisir le numéro d'un autre pour le harceler
    de demandes. Numéros acceptés = mobiles camerounais `+2376` + 8
    chiffres (comme ADR-0017) → sinon 422 `INVALID_PAYMENT_PHONE` (aussi
    pour `ER101` et `ER102`). **Un seul paiement `pending` de moins de
    15 min par utilisateur** → sinon 409 `PAYMENT_IN_PROGRESS_CONFLICT`.
    **5 tentatives par heure et par utilisateur, 3 par jour et par numéro**,
    comptées dans `payments` → sinon 429 `RATE_LIMIT_PAYMENT_ATTEMPTS`.
    Offre inconnue ou inactive → 404 `OFFER_NOT_FOUND`.
11. **Données personnelles** : le numéro n'est **pas stocké en clair** :
    empreinte HMAC-SHA256 (clé dérivée de `BETTER_AUTH_SECRET`, libellé
    propre à `payment`, comme ADR-0017) pour le plafond par numéro, et les
    2 derniers chiffres pour l'affichage. Campay garde le numéro complet :
    la politique de confidentialité le nomme comme prestataire **avant**
    l'ouverture du paiement en production.
12. **Table `payments`** : `id` (UUID v7), `user_id` (suppression en
    cascade : ADR-0016), `offer_code`, `amount_xaf`, `idempotency_key`
    - `request_hash` (unique par utilisateur), `provider`,
      `external_reference` (unique), `provider_reference` (unique, nullable),
      `phone_hmac`, `phone_suffix`, `status`, `confirmed_via`,
      `failure_code`, `created_at`, `updated_at`, `completed_at`. Index pour
      le balayage (`status, created_at`) et les plafonds.
13. **Routes** : `POST /v1/payments` (202), `GET /v1/payments/:id` (404 si
    le paiement n'existe pas ou appartient à un autre utilisateur),
    `POST /v1/webhooks/campay` (sans session, rate-limit global). Campay
    indisponible → 503 `INFRASTRUCTURE_PAYMENT_UNAVAILABLE`, jamais 500
    (RNF-11).
14. **Configuration** : `PAYMENT_PROVIDER`, `CAMPAY_BASE_URL` (test ou
    production), `CAMPAY_TOKEN` (jeton permanent : un seul secret, pas de
    renouvellement ; régénérable dans le tableau de bord en cas de fuite),
    `CAMPAY_WEBHOOK_KEY`. Les deux secrets sont posés par le porteur dans
    SSM (`/voxlivre/main/app/`, SecureString), jamais dans Terraform ni le
    dépôt. Délais courts vers Campay (5 s). **En production**, le schéma
    d'env refuse `fake` (il accorderait des offres sans paiement) et
    n'admet pour Campay que `https://www.campay.net/api` (un paiement de
    démonstration accorderait une vraie offre). Tant que l'ouverture chez
    Campay n'est pas faite, la production tourne en **`disabled`** : les
    routes de paiement répondent 503, aucune ligne n'est créée.
15. **`FakeGateway`** (développement, e2e) : encaissement immédiat, état
    `SUCCESSFUL` à la lecture suivante ; un numéro se terminant par `00`
    donne `FAILED`. Il vérifie les notifications avec une clé de test.

Hors périmètre : remboursements (à la main depuis le tableau de bord
Campay), carte bancaire, renouvellement automatique (impossible en Mobile
Money, ADR-0019), iOS (paiement intégré d'Apple : ADR dédiée), notification
push de confirmation (avec l'app mobile), liste des paiements (l'historique
du portefeuille existe dans `billing`), retraits vers le compte du porteur.

## Conséquences

- Ordre de mise en place : `PAYMENT_PROVIDER=disabled` dans SSM
  (`infra/modules/app_config`, `terraform apply`) **avant** le merge, sinon
  l'API refuse de démarrer en production (défaut `fake`).
- L'API n'accorde rien sans avoir lu l'état chez Campay : une clé webhook
  divulguée ne permet pas d'obtenir une offre gratuite.
- Un paiement confirmé pendant l'arrêt nocturne est accordé au premier
  balayage du matin (au plus ~5 min après le démarrage).
- `api-design.md` et `AGENTS.md` (« signature HMAC sur `rawBody` ») sont
  précisés : la vérification dépend du fournisseur ; chez Campay, JWT HS256
  plus relecture de l'état.
- Essai réel en environnement de test avec un vrai téléphone avant la
  production. Les montants y sont limités : le prix de l'offre est ajusté
  dans la base **locale** seulement, le temps de l'essai.
- Passage en production (« Go Live » chez Campay) : pièces demandées,
  **frais réels** (l'ADR-0019 suppose 1,5 à 3,5 %) et clés de production à
  obtenir par le porteur ; politique de confidentialité mise à jour dans la
  même PR que l'ouverture.
- Les paiements `amount_mismatch` et `failed → succeeded` se traitent à la
  main ; leur fréquence attendue est nulle.

## Vérifié en réel (environnement de test Campay, 2026-10-11)

- Paiement Orange Money de 10 XAF depuis un vrai téléphone : demande reçue,
  confirmée par le code, offre accordée **une fois**. La première
  notification a été refusée (401) parce que la clé webhook posée en local
  n'était pas celle de l'application ; le **balayage** a conclu le paiement
  4 min plus tard. Avec la bonne clé, la notification renvoyée depuis le
  tableau de bord (« Resend Callback ») est acceptée (200) et ne change rien.
- Notification réelle : `POST` JSON (`python-requests`), JWT HS256 dont
  l'en-tête porte aussi `app`, et dont le contenu porte `iat`, `nbf`, `exp`
  (une heure) et `source` ; aucun champ ne désigne la transaction : la
  relecture de l'état (§3) reste nécessaire.
- La relecture renvoie le montant **en texte** (`"10.00"`), pas en nombre
  comme dans la documentation : lu sans arrondi, comparé au prix.
- Erreurs de `POST /collect/` : HTTP 400
  `{"message": …, "error_code": "ER101" | "ER102" | "ER201"}`.
- Une demande **annulée sur le téléphone** reste `PENDING` chez Campay :
  aucune notification `FAILED`. Le paiement est abandonné par le balayage
  après 24 h (`expired`), sans débit ; la règle « un paiement en cours de
  moins de 15 min » évite de bloquer le client entre-temps.
- Un refus de notification est journalisé avec sa raison (`bad_signature`,
  `missing_fields`…) et les **noms** des champs reçus, jamais leurs valeurs.
