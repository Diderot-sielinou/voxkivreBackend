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
│   └── ops/          Scheduler 8 h → 23 h (Douala), snapshots DLM quotidiens, budget 20 $
└── envs/main/        environnement principal (phase 1) — état dans S3, verrou natif
deploy/               (racine du dépôt) compose de prod, Caddyfile, script de boot, unité systemd
```

État d'avancement : **3a** (fondations), **3b** (configuration, instance,
exploitation, imports) et **3c** (premier déploiement, HTTPS Let's Encrypt,
essai de bout en bout) faits. L'API répond sur
`https://voxlivre-app.duckdns.org` aux heures d'ouverture de l'instance.
À venir : étape 4 (déploiement automatique par la CI, OIDC).

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
De même, `terraform.tfvars` (sous-domaine DuckDNS, adresses e-mail) n'est pas
versionné : modèle `envs/main/terraform.tfvars.example`.

**Token DuckDNS** (une fois, avant le premier `apply` de l'instance) — dans
son propre terminal, pour qu'il n'apparaisse ni dans l'historique ni
ailleurs ; Terraform ne le lit jamais :

```bash
read -rs "T?Token DuckDNS : " && echo && \
aws ssm put-parameter --profile voxlivre --region eu-west-3 \
  --name /voxlivre/main/deploy/DUCKDNS_TOKEN --type SecureString --value "$T" \
  && unset T
```

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

## Déployer une version (manuel, jusqu'à l'étape 4)

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
curl -s https://voxlivre-app.duckdns.org/health
```

**Retour arrière** : remettre l'étiquette précédente dans `IMAGE_TAG` et
relancer le service (étape 3). Les 10 dernières images restent dans ECR.
Testé le 2026-10-10 : `4157ab67c36a` → `5ae9b97223e5` → retour arrière →
retour avant, compte, documents et conversions conservés à chaque fois.

**Interruption** : ~15 à 25 s par déploiement, car `systemctl restart`
arrête toute la stack (Postgres et Redis compris). Amélioration prévue avec
l'étape 4 : ne recréer que le conteneur de l'API.
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
(600) depuis SSM, mise à jour de DuckDNS, puis pull + migrations + `up -d`
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
