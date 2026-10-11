# infra/ — Infrastructure AWS de voxlivre-api (Terraform)

Décision : [ADR-0012](../docs/adr/0012-aws-hosting-ec2-then-fargate.md).
Schémas et coûts : [docs/architecture/aws.md](../docs/architecture/aws.md).
Région : **eu-west-3 (Paris)**.

```
infra/
├── bootstrap/        bucket de l'état Terraform — une seule fois, état LOCAL
├── modules/
│   ├── network/      VPC, 1 sous-réseau public, IGW, endpoint S3 Gateway, SG par défaut vidé
│   ├── storage/      bucket applicatif privé (SSE-S3, HTTPS seul, PDF expirés à 3 j)
│   ├── registry/     ECR voxlivre-api (étiquettes immuables, scan, 10 images gardées)
│   ├── app_config/   paramètres SSM /voxlivre/main/{app,deploy}/* + secrets générés
│   ├── app_ec2/      SG 80/443, rôle IAM minimal, logs 7 j, t4g.small AL2023 arm64, volume /data
│   ├── domain/       zone Route 53 voxlivre.store, CAA, identité SES du domaine (DKIM, MAIL FROM, DMARC), MX ImprovMX
│   ├── site/         page d'accueil : bucket privé, CloudFront (OAC), ACM us-east-1, alias voxlivre.store + www
│   ├── ops/          Scheduler 8 h → 23 h (Douala), snapshots DLM quotidiens, budget 20 $
│   └── cicd/         fournisseur OIDC GitHub + rôle de déploiement et de publication du site (moindre privilège)
└── envs/main/        environnement principal (phase 1) — état dans S3, verrou natif
deploy/               (racine du dépôt) compose de prod, Caddyfile, script de boot, unité systemd
site/                 (racine du dépôt) page d'accueil statique, publiée par .github/workflows/site.yml
```

État d'avancement : **3a** (fondations), **3b** (configuration, instance,
exploitation, imports) et **3c** (premier déploiement, HTTPS Let's Encrypt,
essai de bout en bout) faits. L'API répond sur
`https://api.voxlivre.store` aux heures d'ouverture de l'instance (ADR-0018 :
l'IP du moment est publiée dans Route 53 à chaque démarrage).
Étape 4 : **déploiement continu** — chaque merge sur `master` est construit,
scanné et déployé par GitHub Actions (voir ci-dessous).

## Prérequis

- Terraform **1.16.5** (binaire officiel vérifié GPG + SHA-256, dans
  `~/.local/bin`) — même version que la CI.
- AWS CLI v2 et le profil `voxlivre` : `export AWS_PROFILE=voxlivre`.
  Aucun profil ni aucune clé n'est écrit dans le code Terraform : la
  chaîne d'identifiants par défaut s'applique (profil en local, OIDC en CI).
- Conseillé (réseau lent) : cache de plugins partagé entre les dossiers.

  ```bash
  export TF_PLUGIN_CACHE_DIR=~/.terraform.d/plugin-cache
  mkdir -p "$TF_PLUGIN_CACHE_DIR"
  ```

## Première mise en place (déjà faite)

```bash
# 1. Bucket d'état (versionné, chiffré, HTTPS seul, prevent_destroy)
cd infra/bootstrap
terraform init && terraform plan && terraform apply

# 2. Environnement principal sur ce bucket
cd ../envs/main
echo "bucket = \"$(terraform -chdir=../../bootstrap output -raw state_bucket)\"" > backend.hcl
terraform init -backend-config=backend.hcl
terraform plan -out=main.tfplan     # relire, puis :
terraform apply main.tfplan && rm main.tfplan
```

`backend.hcl` n'est pas versionné : le nom du bucket contient l'ID du compte,
que le dépôt (public) ne publie pas. Modèle : `envs/main/backend.hcl.example`.
De même, `terraform.tfvars` (adresses e-mail) n'est pas versionné : modèle
`envs/main/terraform.tfvars.example`.

**Domaine** (ADR-0018) : `voxlivre.store` est acheté chez Namecheap, dont les
serveurs de noms pointent vers la zone Route 53 (`terraform output
name_servers` → Namecheap, _Nameservers → Custom DNS_). Les enregistrements
(CAA, DKIM, MAIL FROM, DMARC) sont dans le module `domain` ; l'enregistrement
`A` de `api` n'est **pas** dans Terraform : le script de boot le réécrit à
chaque démarrage.

**Secrets de comptes tiers** (SMS Orange, ADR-0017) — dans son propre
terminal, pour qu'ils n'apparaissent ni dans l'historique ni ailleurs ;
Terraform ne les lit jamais :

```bash
read -rs "T?Valeur : " && echo && \
aws ssm put-parameter --profile voxlivre --region eu-west-3 \
  --name /voxlivre/main/app/ORANGE_SMS_CLIENT_SECRET --type SecureString --value "$T" \
  && unset T
```

Idem pour `ORANGE_SMS_CLIENT_ID`. Les deux sont lus au prochain démarrage ou
déploiement.

Paiement Campay (ADR-0021), le jour du « Go Live » seulement : même commande
pour `CAMPAY_TOKEN` et `CAMPAY_WEBHOOK_KEY` (clés **de production**), puis
`CAMPAY_BASE_URL=https://www.campay.net/api` et `PAYMENT_PROVIDER=campay`
(ce dernier remplace `disabled` dans `infra/modules/app_config`). En
production, le schéma d'env refuse `fake` et l'URL de démonstration.

L'état du bootstrap est **local** (`infra/bootstrap/terraform.tfstate`, non
versionné). S'il est perdu, rien n'est cassé : on le reconstruit avec
`terraform import aws_s3_bucket.state voxlivre-tfstate-<account-id>` (et
les sous-ressources du bucket de la même façon).

## Travail courant

```bash
cd infra/envs/main
terraform plan -out=main.tfplan   # TOUJOURS relire le plan
terraform apply main.tfplan && rm main.tfplan
terraform plan                    # doit afficher « No changes » (pas de dérive)
```

Règles :

- **Jamais de modification à la main** dans la console sur une ressource
  gérée ici : le prochain `plan` la verrait comme une dérive et la
  défairait.
- Les plans enregistrés (`*.tfplan`) contiennent les valeurs, secrets
  compris : jamais dans Git (cf. `.gitignore`), supprimés après `apply`.
- Buckets en `prevent_destroy` : un `destroy` refuse de les supprimer. Pour
  les supprimer vraiment, retirer d'abord la protection dans une PR.
- Versions épinglées : Terraform `~> 1.16`, provider AWS `~> 6.66.0` ; les
  versions exactes sont dans `.terraform.lock.hcl` (versionné). Monter de
  version = `terraform init -upgrade` dans une PR dédiée.

## Déploiement continu (étape 4)

```
push sur master → CI complète (9 contrôles) → job « Deploy (production) »
  OIDC → rôle voxlivre-main-github-deploy (1 h, aucune clé dans GitHub)
  → build arm64 natif (ubuntu-24.04-arm), sans attestations → push ECR (SHA court)
  → .github/scripts/deploy.sh : scan (CRITICAL bloquant) → IMAGE_TAG (SSM)
     → instance allumée : SSM Run Command relance voxlivre-boot.sh SANS arrêter
       la stack (pull → migrations → seule l'API est recréée) → /health
     → instance éteinte : version prise au prochain démarrage
```

- **Confiance** : le rôle n'accepte que
  `repo:Diderot-sielinou@131718107/voxkivreBackend@1367692888:environment:production`
  (sujet **immuable** de GitHub, activé sur ce dépôt :
  `gh api repos/<dépôt>/actions/oidc/customization/sub`) ;
  l'environnement GitHub `production` n'accepte que `master`. Une PR, une
  autre branche ou un fork ne peut pas déployer.
- **Droits du rôle** : push sur le dépôt ECR et lecture du scan, écriture de
  `IMAGE_TAG` seulement, `SendCommand` sur la seule instance
  (`AWS-RunShellScript`), lecture du résultat et de l'état de l'instance.
  Ni secret, ni infrastructure : Terraform reste appliqué en local.
- **Secret / variable de l'environnement `production`** :
  `AWS_DEPLOY_ROLE_ARN` (sortie `deploy_role_arn`, en secret pour masquer
  l'ID de compte dans les logs) et `API_URL`.
- **Retour arrière** : Actions → **Redeploy** → Run workflow (sur `master`),
  `image_tag` = l'étiquette voulue (`aws ecr describe-images --repository-name voxlivre-api`).
  Pas de reconstruction ; mêmes vérifications. Un déploiement à la fois
  (`concurrency: production`), jamais annulé en cours.
- **Échec** : le workflow échoue (e-mail GitHub) ; pas de retour arrière
  automatique (une migration appliquée ne se défait pas, cf.
  `docs/code-engineering/migrations.md`).

## Page d'accueil `voxlivre.store` (ADR-0020)

```
push sur master touchant site/ → workflow « Site » (ou Run workflow à la main)
  OIDC → même rôle que Deploy (environnement production)
  → aws s3 sync site/ --delete → invalidation CloudFront /* → curl https://voxlivre.store/
```

- Servie par CloudFront depuis un bucket **dédié et privé** (lecture par OAC
  de cette seule distribution) : toujours en ligne, même instance arrêtée.
- Fonction `router` (viewer-request) : `www.` → 301 vers le domaine nu ;
  `/conditions` → `conditions.html`. Clé absente → `404.html` (statut 404).
- En-têtes de sécurité posés par CloudFront (HSTS, CSP sans script, DENY).
  Le site n'a ni script, ni police externe, ni traceur : garder ainsi, ou
  élargir la CSP dans `modules/site`.
- **Secret / variable de l'environnement `production`** : `SITE_BUCKET`
  (sortie `terraform output -raw site_bucket_name`, en secret : contient
  l'ID de compte) et `SITE_DISTRIBUTION_ID` (sortie `site_distribution_id`).
- **Contact** : `contact@voxlivre.store` → boîte du porteur par ImprovMX
  (compte gratuit ; domaine et alias déclarés dans son tableau de bord, `MX`
  dans `modules/domain`).

## Déployer à la main (secours, si la CI est indisponible)

Une version = une image étiquetée par le SHA court (12) du commit de
`master`. Étiquettes immuables : on ne réécrit jamais une version, on en
publie une nouvelle.

```bash
export AWS_PROFILE=voxlivre
git switch master && git pull
TAG=$(git rev-parse --short=12 HEAD)
REPO=$(terraform -chdir=infra/envs/main output -raw ecr_repository_url)

# 1. Image arm64 SANS attestations : sinon Docker pousse un index OCI que le
#    scan ECR de base n'analyse pas, avec des manifestes enfants non
#    étiquetés que la règle de cycle de vie (1 jour) pourrait supprimer.
docker buildx build --platform linux/arm64 --provenance=false --sbom=false \
  --label org.opencontainers.image.revision="$(git rev-parse HEAD)" \
  -t "$REPO:$TAG" --load .
aws ecr get-login-password | docker login --username AWS --password-stdin "${REPO%%/*}"
docker push "$REPO:$TAG"

# 2. Lire le scan : aucune faille CRITICAL avant de déployer. Le scan
#    n'existe que quelques secondes après le push (le waiter échoue avec
#    ScanNotFoundException s'il est lancé trop tôt) : relancer.
aws ecr wait image-scan-complete --repository-name voxlivre-api --image-id imageTag="$TAG"
aws ecr describe-image-scan-findings --repository-name voxlivre-api \
  --image-id imageTag="$TAG" --query imageScanFindings.findingSeverityCounts

# 3. Désigner la version, puis relancer la stack (pull → migrations → up).
aws ssm put-parameter --name /voxlivre/main/deploy/IMAGE_TAG --type String --value "$TAG" --overwrite
aws ssm send-command --instance-ids "$(terraform -chdir=infra/envs/main output -raw instance_id)" \
  --document-name AWS-RunShellScript --parameters 'commands=["systemctl restart voxlivre.service"]'
curl -s https://api.voxlivre.store/health
```

**Retour arrière** : remettre l'étiquette précédente dans `IMAGE_TAG` et
relancer le service (étape 3). Les 10 dernières images restent dans ECR.
Testé le 2026-10-10 : `4157ab67c36a` → `5ae9b97223e5` → retour arrière →
retour avant, compte, documents et conversions conservés à chaque fois.

**Interruption** : `systemctl restart` (geste manuel ci-dessus) arrête
toute la stack, ~15 à 25 s. Le déploiement continu relance le script sans
arrêter la stack : seule l'API est recréée (Postgres, Redis et Caddy restent
en ligne). Mesuré le 2026-10-10 (sonde toutes les 0,5 s) : **~4 à 13 s** de
502, le temps que l'ancienne API s'arrête (workers BullMQ) et que la
nouvelle démarre.
Attention : une migration de base déjà appliquée n'est **pas** annulée —
une migration doit rester compatible avec la version précédente du code.

Instance arrêtée (hors horaires) : `IMAGE_TAG` suffit, la version est prise
au prochain démarrage.

## Exploitation de l'instance

```bash
ID=$(terraform -chdir=infra/envs/main output -raw instance_id)
aws ec2 start-instances --instance-ids "$ID"     # hors horaires (le Scheduler l'arrêtera à 23 h)
aws ec2 stop-instances  --instance-ids "$ID"
aws ssm start-session --target "$ID"             # shell, sans SSH (plugin Session Manager requis)
aws logs tail /voxlivre-main/app --follow        # logs des conteneurs
```

Sur l'instance, à chaque démarrage (sshd désactivé : Session Manager seulement), `voxlivre.service` lance
`/usr/local/bin/voxlivre-boot.sh` (retéléchargé depuis `deploy/` à chaque
fois) : montage de `/data`, écriture de `/etc/voxlivre/{app,deploy}.env`
(600) depuis SSM, IP publiée dans Route 53, puis pull + migrations + `up -d`
— sauf tant que `IMAGE_TAG=none`. Journal : `journalctl -u voxlivre.service -b`.

Modifier la configuration de l'API : changer `app_config` (ou un paramètre
SSM hors Terraform pour `IMAGE_TAG`), `apply`, puis redémarrer le service
(`systemctl restart voxlivre.service`) ou l'instance.

Pièges rencontrés :

- **sshd** : cloud-init le redémarre à chaque boot même `disabled` ; le
  script de boot le **masque** (`systemctl mask`), plus rien n'écoute sur 22.
- **Image poussée en index OCI** (attestations buildx par défaut) : pas de
  scan ECR, enfants non étiquetés exposés au cycle de vie → toujours
  `--provenance=false --sbom=false` (cf. « Déployer une version »).

- **Jamais de `depends_on` sur un module** contenant des sources de
  données : leur lecture est reportée à l'`apply`, leurs valeurs deviennent
  inconnues et le plan veut **remplacer** volume et security group. Passer
  une valeur (ici `deploy_files_etags` → `terraform_data` →
  `depends_on` de la seule instance).
- Les ressources importées (budget, identité SES) doivent être décrites
  **exactement** comme l'existant : relire chaque ligne `~` du plan. Le
  budget exclut les crédits (`RECORD_TYPE` ≠ Credit/Refund), sans quoi il
  resterait à 0 $ et n'alerterait jamais.

## Contrôles en CI

Job `Terraform (fmt + validate)` de `.github/workflows/ci.yml` : formatage,
puis `init -backend=false` + `validate` de chaque racine, sans identifiants
AWS. Le `plan`/`apply` depuis la CI arrivera avec l'étape 4 (OIDC).

## Coût

≈ 14,50 $/mois avec l'horaire 8 h → 23 h tous les jours (≈ 21 $ en
continu) : détail dans [docs/architecture/aws.md](../docs/architecture/aws.md).
Aucune NAT Gateway, aucune Elastic IP ; le budget (20 $/mois, dépense avant
crédits) alerte à 85 %, 100 % et 100 % prévu.
