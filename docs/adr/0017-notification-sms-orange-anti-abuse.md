# 0017. Module notification : SMS par l'API Orange Cameroun, garde-fous anti-abus

- Statut : accepted
- Date : 2026-10-10
- Tags : `notification`, `identity`, `sms`, `sécurité`, `coût`
- Précise : ADR-0004 (livraison des codes « via le module notification ») et
  ADR-0014 (e-mail par SES, dont l'adapter quitte `identity`).

## Contexte

En production, aucun SMS n'est envoyé : une connexion par téléphone (RF-16,
canal principal au Cameroun) ne produit qu'une ligne de log. Constaté le
2026-10-10 :

- le SMS d'AWS (SNS, End User Messaging) répond
  `SubscriptionRequiredException` sur le plan Free du compte ;
- prix relevés : **Orange SMS API Cameroun 17 à 22 FCFA** par SMS (tous
  opérateurs, paiement Orange Money ou crédit, nom d'expéditeur gratuit sur
  demande, 5 SMS/s) ; LMT Group 17–18 FCFA ; Twilio **0,317 $** (≈ 190 FCFA) ;
  WhatsApp (authentification) ≈ 0,004 $ selon des sources secondaires, mais
  vérification Meta et modèle à faire approuver.

Un SMS coûte de l'argent à chaque envoi : la route d'envoi de code est une
cible de **« SMS pumping »** (des robots déclenchent des milliers de SMS,
souvent vers des numéros internationaux surtaxés, aux frais du service).

## Options

1. **Orange SMS API** derrière un port `SmsSenderPort`.
2. Twilio : intégration immédiate par carte, mais 9 fois plus cher.
3. AWS End User Messaging : tout chez AWS par rôle, mais plan payant
   obligatoire, prix Cameroun non affiché, enregistrement de l'expéditeur.
4. WhatsApp : le moins cher, mais démarches Meta et couverture incomplète —
   candidat pour une étape ultérieure, avec le SMS en secours.

## Décision

**Option 1**, dans un nouveau module `notification`.

1. **Module `notification`** : ports `SmsSenderPort` et `EmailSenderPort`,
   adapters `OrangeSmsAdapter` (OAuth2 `client_credentials`, jeton mis en
   cache jusqu'à 1 min avant expiration, timeouts courts) et
   `SesEmailAdapter` (repris d'`identity`, ADR-0014). Un use-case unique
   d'envoi de code choisit le canal, applique les garde-fous et compose le
   message. `identity` l'appelle derrière son `OtpSenderPort`.
2. **Numéros acceptés : mobiles camerounais** (`+2376` + 8 chiffres), vérifié
   par `phoneNumberValidator` de better-auth **avant** la création du code
   → 400 `INVALID_PHONE_NUMBER`. L'ouverture à d'autres pays sera une
   décision explicite (coût, fraude).
3. **Plafonds** :
   - **3 codes par destination et par heure**, SMS **et** e-mail (protège
     aussi une boîte mail tierce d'un bombardement) ;
   - **plafond quotidien global de SMS** (`SMS_DAILY_LIMIT`, 300 par
     défaut), journée UTC ; alerte `warn` dans les logs à 80 %.
     Dépassement → `rate_limited` :
   - **SMS** : better-auth répond **429** (`OTP_RATE_LIMITED`), l'utilisateur
     sait pourquoi rien n'arrive ;
   - **e-mail** : aucun e-mail n'est envoyé, mais la réponse reste **200** —
     better-auth avale toute erreur de `sendVerificationOTP`
     (`runInBackgroundOrAwait`, constaté en essai réel le 2026-10-10). Accepté :
     la réponse ne révèle rien sur l'adresse, et l'écran de connexion invite
     déjà à vérifier les spams puis à réessayer plus tard.
4. **Journal des envois en base** (`otp_dispatches`), jamais en clair :
   destination remplacée par une **empreinte HMAC-SHA256** (clé dérivée de
   `BETTER_AUTH_SECRET`, libellé dédié) — un simple SHA-256 d'un numéro
   (≈ 10⁸ possibilités) se retrouve par force brute. Purge quotidienne des
   lignes de plus de 2 jours. Un léger dépassement est possible si deux
   requêtes simultanées comptent en même temps : accepté pour un garde-fou
   de coût (pas un verrou comptable).
5. **Panne du fournisseur** : jamais d'exception vers better-auth (sa route
   répondrait 500) ; résultat `failed`, loggé avec le nom de l'erreur et le
   statut HTTP, sans le code ni la destination (numéro masqué
   `+2376••••••12` au mieux).
6. **Secrets** `ORANGE_SMS_CLIENT_ID` et `ORANGE_SMS_CLIENT_SECRET` posés par
   le porteur dans SSM (SecureString, `/voxlivre/main/app/`), jamais dans
   Terraform ni dans le dépôt. `ORANGE_SMS_SENDER_NAME` (ex. `VOXLIVRE`)
   seulement une fois le nom approuvé par Orange : un nom non approuvé fait
   échouer l'envoi (400).
7. **Mode `log`** inchangé pour le développement (codes dans les logs).

## Conséquences

- Coût : ≈ 22 FCFA par code SMS ; budget plafonné par `SMS_DAILY_LIMIT`
  (300 × 22 = 6 600 FCFA/jour au pire). Le solde Orange est consultable
  (`/sms/admin/v1/contracts`) ; un pack épuisé fait échouer les envois
  (`failed`) jusqu'à recharge.
- Un pays de plus = changer la règle du numéro **et** revoir les plafonds.
- WhatsApp ou un autre fournisseur = un nouvel adapter de `SmsSenderPort`.
- Les notifications push (fin de conversion) restent à faire avec l'app
  mobile.
- Le domaine d'envoi des e-mails (`voxlivre.store`, DKIM, sortie du bac à
  sable SES) fera l'objet d'une ADR séparée.
