# 0018. Domaine `voxlivre.store` : DNS Route 53, `api.voxlivre.store`, e-mails authentifiés par SES

- Statut : accepted
- Date : 2026-10-10
- Tags : `aws`, `dns`, `sécurité`, `e-mail`, `coût`
- Précise : ADR-0012 (pas d'Elastic IP ; le DNS suit l'IP au démarrage),
  ADR-0014 (expéditeur des codes) et ADR-0017 (« le domaine d'envoi fera
  l'objet d'une ADR séparée »). Remplace le sous-domaine DuckDNS de
  `docs/architecture/aws.md`.

## Contexte

- L'API est servie sur `voxlivre-app.duckdns.org`. Cette adresse sera inscrite
  dans l'application mobile : la changer après la première version publiée
  oblige à republier l'application.
- Les codes partent de l'adresse Gmail du porteur, une identité SES
  « adresse » sans authentification de domaine. Le compte SES est en **bac à
  sable** : il n'envoie qu'aux adresses vérifiées, 200 e-mails par jour.
  ADR-0014 pose la condition avant les vrais utilisateurs : un domaine
  authentifié (DKIM) et la sortie du bac à sable.
- Tant que les SMS sont bloqués (ADR-0017 : identifiants Orange, pack),
  l'e-mail est le seul canal qui peut servir des testeurs.
- Le domaine `voxlivre.store` a été acheté chez Namecheap le 2026-10-10
  (échéance 2027-10-10, renouvellement automatique, protection WHOIS
  active).
- L'instance n'a pas d'IP fixe (ADR-0012) : arrêtée chaque nuit, elle
  reçoit une nouvelle IP publique à chaque démarrage. Le script de boot met
  aujourd'hui DuckDNS à jour avec un jeton posé à la main dans SSM.

## Options

**Hébergement du DNS**

1. **Route 53** : une zone gérée par Terraform ; chez Namecheap, seuls les
   serveurs de noms changent.
2. DNS de Namecheap + son DNS dynamique : gratuit, mais les enregistrements
   e-mail (DKIM, MAIL FROM, DMARC) se saisissent à la main dans une
   interface web. L'API Namecheap exige une IP en liste blanche et un solde
   minimal : pas de gestion par Terraform en pratique.

**IP changeante**

1. **Mise à jour de l'enregistrement au démarrage** par le rôle de
   l'instance.
2. Elastic IP : ≈ 3,6 $/mois, facturée même instance arrêtée — plus que tout
   le reste du DNS.

## Décision

**Route 53**, enregistrement mis à jour au démarrage, e-mails authentifiés
sur le domaine.

1. **Zone Route 53 `voxlivre.store`** gérée par Terraform. Le porteur
   remplace les serveurs de noms chez Namecheap (« Custom DNS ») par les
   quatre serveurs de la zone (sortie Terraform).
2. **L'API sur `api.voxlivre.store`.** Le domaine nu reste libre pour une
   future page de présentation et de politique de confidentialité (exigée
   par le Play Store, demandée par la revue SES).
3. **IP changeante** : au démarrage, le script UPSERT l'enregistrement `A`
   de `api` (TTL 60 s), puis attend la confirmation de Route 53
   (`resource-record-sets-changed`) avant de démarrer Caddy. Moindre
   privilège : le rôle de l'instance n'a `route53:ChangeResourceRecordSets`
   que sur cette zone, **pour le seul nom `api.voxlivre.store`, le seul type
   `A` et la seule action `UPSERT`** (clés de condition
   `route53:ChangeResourceRecordSets*`), plus `route53:GetChange`.
4. **DuckDNS retiré** au basculement : code du script, jeton SSM, variable
   Terraform. Aucun client n'en dépend (pas encore d'application publiée).
5. **Expéditeur `noreply@voxlivre.store`**, affiché **« Voxlivre »**. Le
   nom affiché est ajouté par l'adapter SES (c'est la marque du produit, pas
   une configuration d'environnement) ; `OTP_EMAIL_FROM` reste une adresse
   nue validée par Zod.
6. **Authentification du domaine**, enregistrements créés par Terraform :
   - **Easy DKIM** RSA 2048 bits (trois `CNAME` `…._domainkey`) ;
   - **domaine MAIL FROM** `mail.voxlivre.store` (`MX` vers le point de
     retour SES de la région, `TXT` SPF `include:amazonses.com`) : SPF est
     alors aligné sur le domaine et Gmail n'affiche plus « via
     amazonses.com ». Si le `MX` est introuvable, SES revient au domaine
     par défaut plutôt que de refuser l'envoi ;
   - **DMARC** `p=none` d'abord, `p=quarantine` une fois les premiers envois
     constatés `pass` ; pas d'adresse de rapports (aucune boîte sur le
     domaine).
7. **`CAA`** : seul Let's Encrypt peut émettre un certificat pour le
   domaine.
8. **Pas de réception d'e-mails** (aucun `MX` sur le domaine nu). L'adresse
   Gmail du porteur **reste une identité SES vérifiée** tant que le compte
   est en bac à sable : c'est le seul destinataire autorisé pour les
   essais. Le rôle de l'instance garde `ses:SendEmail` sur les deux
   identités pendant cette période (en bac à sable, SES contrôle aussi
   l'identité du destinataire).
9. **Sortie du bac à sable** demandée (console SES) une fois l'identité de
   domaine vérifiée : codes transactionnels seulement, volume estimé, rebonds
   et plaintes traités par la liste de suppression du compte SES (active par
   défaut), aucun envoi marketing.
10. **Ordre de mise en place**, imposé par la délégation DNS : (a) zone et
    enregistrements e-mail ; (b) serveurs de noms changés chez Namecheap,
    délégation vérifiée (`dig NS`) ; (c) seulement ensuite, bascule de
    `DOMAIN` / `BETTER_AUTH_URL` / `OTP_EMAIL_FROM` et du script — sans
    délégation, Caddy n'obtiendrait pas son certificat.

11. **Alarmes de réputation SES** (module `ops`) : taux de rebond ≥ 4 % et
    taux de plainte ≥ 0,08 % (seuils de revue AWS : 5 % et 0,1 %), vers un
    sujet SNS abonné à l'adresse d'alerte du budget (abonnement à confirmer
    une fois par e-mail). Sans envoi, pas de donnée : l'alarme reste OK.
12. **Domaine nu = future page d'accueil du produit** (présentation,
    téléchargement des applications, politique de confidentialité). Elle
    sert aussi de « Website URL » à la demande de sortie du bac à sable :
    la demande attend cette page. Sa réalisation fera l'objet d'une ADR
    (hébergement statique hors de l'instance, qui est arrêtée la nuit).

Hors périmètre : DNSSEC (≈ 1 $/mois de clé KMS et une procédure de plus),
la page de présentation elle-même.

## Conséquences

- Coût : zone Route 53 **0,50 $/mois** (hors offre gratuite), requêtes
  négligeables à notre volume ; SES inchangé. Le renouvellement d'un `.store`
  est souvent bien plus cher que la première année : prix à vérifier chez
  Namecheap avant l'échéance.
- Plus de jeton tiers : le DNS se met à jour par le rôle IAM de l'instance.
- Un démarrage dépend de Route 53 en plus de SSM et ECR ; si la mise à jour
  échoue, l'API démarre quand même (l'ancienne IP reste publiée, alerte
  dans le journal), comme avec DuckDNS.
- La variable GitHub `API_URL` (vérification après déploiement) passe à
  `https://api.voxlivre.store`.
- Les sessions existantes restent valides : le jeton bearer est signé par
  `BETTER_AUTH_SECRET`, indépendant de l'URL.
- La phase 3 (vitrine Fargate, ADR-0012) pourra publier son propre nom dans
  la même zone.
- Si la page d'accueil est servie par CloudFront avec un certificat ACM,
  le `CAA` devra autoriser aussi `amazon.com`.
- DMARC passe en `quarantine` dans un changement ultérieur, après
  constatation des en-têtes `pass`.
