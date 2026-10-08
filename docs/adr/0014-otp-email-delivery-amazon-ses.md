# 0014. Livraison des codes OTP par e-mail : Amazon SES, sans attendre le module notification

- Statut : accepted
- Date : 2026-10-08
- Tags : `identity`, `aws`, `sécurité`
- Précise : ADR-0004 (« email/SMS via le module notification ensuite ») pour
  le canal e-mail. Le reste d'ADR-0004 est inchangé.

## Contexte

En production, `OTP_DELIVERY_MODE=log` est refusé (ADR-0004) et le mode
`notification` levait une erreur au boot : sans canal de livraison réel,
l'API ne pouvait pas être déployée sur AWS (ADR-0012). Le module
`notification` (push de fin de conversion, SMS) n'est pas encore conçu.

Le compte AWS du projet donne accès à **Amazon SES** dans eu-west-3, avec les
mêmes identifiants que S3 et Polly (rôle d'instance, aucune clé). Un compte
SES neuf est en **bac à sable** : 200 e-mails/24 h, uniquement vers des
adresses vérifiées, jusqu'à une demande d'accès production. Une identité
expéditrice (adresse) a été vérifiée le 2026-10-08.

## Options

1. **SES via le SDK** (`@aws-sdk/client-sesv2`), adapter derrière le
   `OtpSenderPort` existant : même chaîne d'identifiants que Polly et S3.
2. **SMTP SES via nodemailer** : identifiants SMTP dérivés d'une clé IAM
   longue durée — un secret de plus à stocker et faire tourner.
3. **Fournisseur tiers** (Brevo, Resend…) : un compte, une clé API et une
   facture de plus, hors du périmètre d'apprentissage AWS.
4. **Attendre le module `notification`** : bloque le déploiement de l'étape 3.

## Décision

**Option 1.**

1. `SesEmailOtpSender` dans `identity/infrastructure/otp/`, câblé par
   `OTP_DELIVERY_MODE=notification` ; le domaine et better-auth ne changent
   pas (RNF-17). Quand le module `notification` existera, il pourra reprendre
   cet adapter derrière le même port.
2. Variables : `OTP_EMAIL_FROM` (identité vérifiée dans SES) et `AWS_REGION`,
   **obligatoires avec `notification`** (règle Zod, échec au boot plutôt
   qu'au premier envoi).
3. Contrat du port : **ne lève jamais** (better-auth renverrait une 500) ; un
   échec est loggé, l'utilisateur redemande un code.
4. **Aucune PII dans les logs** : ni le code, ni l'adresse, ni le `message`
   de l'erreur du SDK — SES y recopie le destinataire (constaté à l'essai
   réel) ; seuls le nom de l'erreur et le statut HTTP sont loggés.
5. Message en texte brut, en français, objet selon le motif (`sign-in`,
   `email-verification`…).
6. **SMS non branché** : une demande par téléphone est loggée (sans le code)
   et n'est pas livrée. Le canal SMS (SNS ou agrégateur local) fera l'objet
   d'une ADR avec le module `notification`.

## Conséquences

- Coût : 0,10 $ pour 1 000 e-mails — négligeable.
- **Avant d'ouvrir à de vrais utilisateurs** : sortir du bac à sable (demande
  dans la console SES) et envoyer depuis un **domaine vérifié avec DKIM** ;
  une adresse Gmail en expéditeur convient aux essais mais risque le dossier
  spam (alignement DMARC impossible).
- Le rôle d'instance (étape 3, Terraform) reçoit `ses:SendEmail` limité à
  l'identité expéditrice.
- Les comptes téléphone restent sans livraison réelle en production tant que
  le canal SMS n'existe pas : seule la connexion par e-mail fonctionne.
