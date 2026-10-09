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
│   └── registry/     ECR voxlivre-api (étiquettes immuables, scan, 10 images gardées)
└── envs/main/        environnement principal (phase 1) — état dans S3, verrou natif
```

État d'avancement : **3a** (fondations) appliquée. À venir : 3b (instance,
rôle IAM, SSM, Scheduler, Budget, imports), 3c (premier déploiement HTTPS).

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

## Contrôles en CI

Job `Terraform (fmt + validate)` de `.github/workflows/ci.yml` : formatage,
puis `init -backend=false` + `validate` de chaque racine, sans identifiants
AWS. Le `plan`/`apply` depuis la CI arrivera avec l'étape 4 (OIDC).

## Coût de la 3a

Quasi nul : VPC, IGW et endpoint Gateway S3 sont gratuits ; buckets et ECR
facturés au volume stocké (vides au départ, ECR gratuit jusqu'à 500 Mo).
Aucune NAT Gateway, aucune Elastic IP.
