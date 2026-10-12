# 0023. Suppression de compte : immédiate, après reconnexion, paiements conservés

- Statut : accepted
- Date : 2026-10-12
- Tags : `identity`, `rgpd`, `paiement`, `stockage`
- Complète : ADR-0016 (outbox des fichiers), ADR-0021 (paiements).
  Exigence Google Play (suppression de compte depuis l'app **et** depuis le
  web) ; loi camerounaise n° 2024/017 sur les données personnelles (droit à
  l'effacement).

## Contexte

- Aucune route ne permet de supprimer un compte. Google Play refuse une app
  qui crée des comptes sans offrir leur suppression, dans l'app et par une
  adresse web.
- En base, presque tout dépend de `user` en `ON DELETE CASCADE` : sessions,
  documents, pages, conversions, positions, quota, pass, portefeuille,
  écritures de crédits. **Mais aussi `payments` et `purchases`** : supprimer
  un compte effacerait la preuve d'un encaissement Mobile Money, que le
  droit comptable OHADA impose de garder 10 ans.
- Les fichiers (PDF source, audio, WebVTT) sont dans le stockage objet, hors
  de toute transaction : l'outbox `pending_file_deletions` (ADR-0016) a été
  prévue pour ce cas.
- La route intégrée de better-auth (`/delete-user`) est désactivée par
  défaut ; elle ne connaît ni l'outbox, ni les conversions en cours, ni les
  paiements en attente.
- Les snapshots quotidiens du volume de données sont gardés 7 jours.

## Options

1. **Délai de grâce** (compte désactivé 30 jours, annulable, puis effacé par
   une tâche) : un état de plus partout (connexion, balayages, quotas),
   pour un besoin non exprimé.
2. **Route better-auth `/delete-user`** avec des hooks : transaction et
   refus métier difficiles à garantir hors de notre unité de travail.
3. **Effacement immédiat par un use-case `identity`**, dans une transaction,
   après une reconnexion récente.

## Décision

**Option 3.**

1. `DELETE /v1/me` → **204**. Dans **une** transaction :
   1. refus **409 `ACCOUNT_DELETION_CONFLICT`** si une conversion du compte
      travaille encore (`details.reason = conversion_in_progress`, même
      règle qu'un document, ADR-0016) ou si un paiement est en attente
      (`payment_pending` : l'argent serait débité sans compte pour le
      recevoir) ;
   2. inscription dans l'outbox de **toutes** les clés de fichiers du
      compte (sources pas encore supprimées, fichiers des conversions) ;
   3. suppression de l'utilisateur : la cascade emporte le reste.
2. **Reconnexion récente** : la session doit avoir moins de **10 minutes**,
   sinon **403 `RECENT_LOGIN_REQUIRED`** ; l'app redemande un code OTP. Un
   jeton volé ou oublié sur un appareil ne suffit pas à détruire un compte.
   Pas de nouveau flux de code : la connexion OTP existante sert de preuve.
3. **Paiements et achats conservés, détachés** : `payments.user_id` et
   `purchases.user_id` deviennent nullables en `ON DELETE SET NULL`
   (migration `0013`). Il reste montant, offre, référence Campay, HMAC du
   numéro et ses 3 derniers chiffres : de quoi répondre à un litige, plus
   rien qui désigne le compte. Les pass, portefeuilles et écritures de
   crédits (état interne) partent avec le compte.
4. **Pass et crédits restants perdus**, sans remboursement : l'app les
   affiche (`GET /v1/billing/account`) dans la confirmation.
5. **Rien n'est gardé pour l'anti-abus** (minimisation) : recréer un compte
   pour retrouver le palier gratuit est déjà possible avec un autre e-mail.
6. **Demande sans l'app** : un script d'exploitation appelle le même
   use-case à partir d'une adresse e-mail (`pnpm account:delete`, lancé
   sur l'instance par Session Manager), décrit dans le runbook. La page web
   « Supprimer mon compte » (demande par e-mail à `contact@voxlivre.store`)
   est publiée avec la politique de confidentialité.
7. La route better-auth `/delete-user` reste **désactivée** (un test le
   prouve).
8. Rejouer la requête : la session n'existe plus → 401.

## Conséquences

- Migration `0013` : deux colonnes rendues nullables et deux clés
  étrangères changées (`SET NULL`) ; compatible avec la version précédente
  du code, qui n'écrit jamais `NULL`.
- Les paiements détachés ne sont visibles par personne via l'API ; le
  balayage de réconciliation les ignore (aucun n'est en attente, §1.1).
- Les fichiers disparaissent en moins d'une minute, les données des
  sauvegardes en 7 jours au plus : à écrire dans la politique de
  confidentialité.
- Le journal `otp_dispatches` (destinataires hachés, purgé) et les codes
  `verification` (expirés en minutes) ne sont pas liés au compte et restent
  gérés par leur propre purge ou expiration.
