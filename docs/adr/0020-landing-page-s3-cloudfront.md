# 0020. Page d'accueil `voxlivre.store` : site statique S3 + CloudFront, contact par redirection

- Statut : accepted
- Date : 2026-10-11
- Tags : `aws`, `dns`, `site`, `coût`, `e-mail`, `juridique`
- Réalise : ADR-0018 §12 (« domaine nu = future page d'accueil, hébergement
  statique hors de l'instance »). Modifie ADR-0018 §7 (`CAA`) et §8
  (réception d'e-mails sur le domaine nu).

## Contexte

- SES est en **bac à sable** : seule l'adresse du porteur reçoit un code
  (ADR-0018). Le formulaire de sortie demande une « Website URL » décrivant
  le service ; sans page publique, la demande a peu de chances d'aboutir.
- Le Play Store, l'App Store et la loi camerounaise n° 2024/017 relative à la
  protection des données à caractère personnel imposent une **politique de
  confidentialité** publique, accessible avant l'inscription.
- L'instance est **arrêtée de 23 h à 8 h** (heure de Douala, ADR-0012) : un
  site servi par Caddy serait hors ligne neuf heures par jour.
- Aucune boîte ne reçoit de courrier sur le domaine (ADR-0018 §8), alors
  qu'une politique de confidentialité doit donner un contact pour exercer
  ses droits (accès, suppression), et que AWS et les stores en demandent un.
- Le domaine est déjà dans une zone Route 53 gérée par Terraform.

## Options

**Hébergement**

1. **S3 privé + CloudFront** (accès par OAC), certificat ACM : disponible en
   permanence, sans serveur, dans l'offre gratuite permanente de CloudFront
   (1 To et 10 millions de requêtes par mois).
2. Caddy sur l'instance : coût nul, mais hors ligne la nuit, et la page
   tomberait avec l'API.
3. Hébergeur tiers (GitHub Pages, Netlify) : gratuit, mais un compte et un
   DNS de plus à surveiller, en dehors de Terraform.

**Contact**

1. **Redirection par un service tiers (ImprovMX, offre gratuite)** :
   `contact@` → boîte Gmail du porteur, deux `MX` sur le domaine nu.
2. Réception SES : n'existe pas dans la région de Paris (eu-west-3) ; il
   faudrait une seconde région, une règle de réception et une Lambda de
   réexpédition.
3. Redirection Namecheap : impose les `MX` de Namecheap, sans tableau de
   bord ni journal des messages reçus.

## Décision

**S3 + CloudFront, géré par Terraform (module `site`), contact par
ImprovMX.**

1. **Bucket dédié** `voxlivre-site-<compte>`, privé (Block Public Access,
   propriétaire imposé, chiffrement SSE-S3). Seule la distribution CloudFront
   le lit, par **OAC** (condition `AWS:SourceArn` sur la distribution). Aucun
   mélange avec le bucket applicatif : une erreur de politique sur le site ne
   peut pas exposer un PDF ou un audio.
2. **Certificat ACM en us-east-1** (exigence de CloudFront) pour
   `voxlivre.store` et `www.voxlivre.store`, validé par DNS dans la zone.
   Le `CAA` autorise désormais `amazon.com` en plus de Let's Encrypt.
3. **Distribution CloudFront** : HTTPS imposé (redirection depuis HTTP),
   TLS 1.2 minimum, HTTP/2 et HTTP/3, IPv6, classe de prix **200** (inclut le
   point de présence de Lagos, le plus proche du Cameroun), politique de
   cache gérée « CachingOptimized », compression.
4. **Une fonction CloudFront (viewer-request)** : `www.` → redirection 301
   vers le domaine nu ; `/confidentialite` → `/confidentialite.html` ;
   `/dossier/` → `/dossier/index.html`. Les URL restent propres sans serveur.
5. **En-têtes de sécurité** posés par CloudFront : HSTS (2 ans), CSP stricte
   (`default-src 'none'`, styles et images du site seulement, aucun script),
   `X-Content-Type-Options`, `Referrer-Policy`, `frame-ancestors 'none'`.
   Le site n'a **ni JavaScript, ni police externe, ni traceur, ni cookie**.
6. **Page introuvable** : S3 répond 403 sur une clé absente (l'OAC n'a pas
   `ListBucket`) ; CloudFront le transforme en `404.html` avec le statut 404.
7. **DNS** : `A` et `AAAA` en alias vers la distribution pour le domaine nu et
   `www`.
8. **Contenu** : dossier `site/` du dépôt, HTML et CSS écrits à la main, en
   français : accueil (application « bientôt disponible »), politique de
   confidentialité, conditions d'utilisation (dont l'attestation de droits
   sur les PDF, ADR-0007), page 404. Les textes juridiques sont relus par le
   porteur ; ce ne sont pas des avis juridiques.
9. **Publication** : workflow `site.yml`, déclenché par un push sur master
   qui touche `site/` (ou à la main). Il endosse le rôle OIDC existant
   (environnement `production`), élargi au strict nécessaire : lister,
   écrire et supprimer dans le bucket du site, invalider la distribution.
   `aws s3 sync --delete`, puis invalidation de `/*` (gratuite jusqu'à
   1 000 chemins par mois ; `/*` compte pour un). Indépendant du déploiement
   de l'API : modifier un texte ne reconstruit pas d'image.
10. **Contact** : `contact@voxlivre.store` redirigé par **ImprovMX** vers la
    boîte du porteur (`MX` 10 `mx1.improvmx.com`, 20 `mx2.improvmx.com` sur
    le domaine nu), et **`SPF` sur le domaine nu**
    (`v=spf1 include:spf.improvmx.com ~all`) : ImprovMX réexpédie avec notre
    domaine comme adresse de retour (SRS) ; sans ce SPF, Gmail classerait les
    messages redirigés en spam. Il ne touche pas aux codes, dont le SPF est
    sur `mail.voxlivre.store` (ADR-0018). Les réponses partent pour l'instant
    de la boîte Gmail.
11. **Demande de sortie du bac à sable SES** : soumise par le porteur dans la
    console, une fois la page en ligne (texte préparé dans la note 21).

Hors périmètre : formulaire de contact (il faudrait un backend), WAF
(≈ 6 $/mois, rien à protéger sur un site statique), statistiques de visite,
version anglaise, liens vers les stores (ajoutés à la publication de
l'application).

## Conséquences

- Coût : **≈ 0 $/mois** (ACM et OAC gratuits, S3 et CloudFront dans l'offre
  gratuite à notre volume ; la zone Route 53 était déjà payée).
- Le provider AWS a un alias `us_east_1` dans `envs/main` (certificat ACM) ;
  le module `site` le reçoit par `configuration_aliases`.
- Ordre de mise en place : `apply` du module `site` et du rôle élargi
  **avant** le merge de `site.yml`, sinon la première publication échoue.
  Le secret GitHub `SITE_BUCKET` (son nom contient l'ID de compte, masqué
  dans les journaux comme pour l'API) et la variable `SITE_DISTRIBUTION_ID`
  de l'environnement `production` viennent des sorties Terraform.
- Le porteur crée un compte ImprovMX (gratuit), y déclare le domaine et
  l'alias `contact` ; les `MX` sont dans Terraform.
- Un domaine nu avec `MX` reçoit aussi du spam : il est filtré par ImprovMX
  puis Gmail.
- La politique de confidentialité décrit l'état réel du service ; elle doit
  être mise à jour à chaque nouvelle donnée collectée (paiement Mobile Money,
  notifications push) et quand la suppression de compte sera disponible dans
  l'application (aujourd'hui : demande par e-mail).
