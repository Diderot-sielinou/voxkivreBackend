# Environnement principal — phase 1 d'ADR-0012 (EC2 + Docker Compose).
# 3a : fondations (réseau, stockage, registre). 3b : configuration (SSM),
# instance et son rôle, exploitation (Scheduler, sauvegardes, budget), envoi
# des e-mails (SES). Domaine voxlivre.store : DNS Route 53 et identité SES
# du domaine (ADR-0018). Page d'accueil S3 + CloudFront (ADR-0020). Variables : variables.tf ; valeurs personnelles dans
# terraform.tfvars (non versionné).

# Identifiants : chaîne par défaut du SDK — AWS_PROFILE=voxlivre en local,
# rôle OIDC en CI (étape 4). Aucun profil écrit ici.
provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project   = "voxlivre"
      Env       = "main"
      ManagedBy = "terraform"
    }
  }
}

# Certificats ACM de CloudFront : us-east-1 uniquement (module site).
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"

  default_tags {
    tags = {
      Project   = "voxlivre"
      Env       = "main"
      ManagedBy = "terraform"
    }
  }
}

data "aws_caller_identity" "current" {}

locals {
  name = "voxlivre-main"
  # Domaine du produit (ADR-0018), acheté chez Namecheap ; l'API sur `api.`,
  # le domaine nu sert la page d'accueil (ADR-0020).
  product_domain = "voxlivre.store"
  domain         = "api.${local.product_domain}"
  ssm_prefix     = "/voxlivre/main"

  # Étiquette posée sur le volume de données et ciblée par la sauvegarde DLM.
  backup_tag = { "voxlivre:backup" = "daily" }
}

module "network" {
  source = "../../modules/network"

  name       = local.name
  region     = var.region
  cidr_block = "10.20.0.0/16"
}

module "storage" {
  source = "../../modules/storage"

  # Unicité globale par l'ID de compte, sans l'écrire dans le dépôt.
  bucket_name               = "${local.name}-${data.aws_caller_identity.current.account_id}"
  source_pdf_retention_days = 3
}

module "registry" {
  source = "../../modules/registry"

  repository_name = "voxlivre-api"
  images_to_keep  = 10
}

module "domain" {
  source = "../../modules/domain"

  domain_name  = local.product_domain
  region       = var.region
  dmarc_policy = "none"
}

module "site" {
  source = "../../modules/site"
  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }

  name        = local.name
  bucket_name = "voxlivre-site-${data.aws_caller_identity.current.account_id}"
  domain_name = local.product_domain
  zone_id     = module.domain.zone_id
}

module "app_config" {
  source = "../../modules/app_config"

  prefix           = local.ssm_prefix
  environment      = "main"
  region           = var.region
  domain           = local.domain
  dns_zone_id      = module.domain.zone_id
  bucket_name      = module.storage.bucket_name
  image_repository = module.registry.repository_url
  otp_sender_email = "noreply@${local.product_domain}"
}

module "app_ec2" {
  source = "../../modules/app_ec2"

  name                = local.name
  region              = var.region
  subnet_id           = module.network.public_subnet_id
  bucket_name         = module.storage.bucket_name
  bucket_arn          = module.storage.bucket_arn
  ecr_repository_arn  = module.registry.repository_arn
  ses_identity_arns   = [module.domain.ses_identity_arn, aws_sesv2_email_identity.sandbox_recipient.arn]
  dns_zone_arn        = module.domain.zone_arn
  dns_record_name     = local.domain
  ssm_prefix          = module.app_config.ssm_prefix
  root_volume_size_gb = 20
  data_volume_size_gb = 10
  backup_tag          = local.backup_tag

  # https://github.com/docker/compose/releases/download/v5.5.1/checksums.txt
  compose_version        = "v5.5.1"
  compose_sha256_aarch64 = "732e3a84c1a0f67256ce80bc2598a24546b10ca05f9faa97efceb1171ece2ef7"

  # Le user data lit deploy/ dans le bucket : l'instance attend leur
  # publication. Passé en valeur, PAS en `depends_on` de module (qui
  # différerait toutes les sources de données du module à l'apply et
  # forcerait des remplacements).
  deploy_files_etags = { for k, o in aws_s3_object.deploy : k => o.etag }
}

module "ops" {
  source = "../../modules/ops"

  name         = local.name
  instance_id  = module.app_ec2.instance_id
  instance_arn = module.app_ec2.instance_arn

  # Tous les jours, 8 h → 23 h (heure de Douala).
  timezone   = "Africa/Douala"
  start_cron = "0 8 * * ? *"
  stop_cron  = "0 23 * * ? *"

  backup_tag             = local.backup_tag
  backup_time_utc        = "21:30" # 22 h 30 à Douala (UTC+1), avant l'arrêt
  backup_retention_count = 7

  budget_name      = "My Monthly Cost Budget"
  budget_limit_usd = "20.0"
  alert_email      = var.budget_alert_email
}

module "cicd" {
  source = "../../modules/cicd"

  name   = local.name
  region = var.region
  # Sujet immuable (identifiants publics du compte et du dépôt GitHub).
  github_subject_prefix   = "repo:Diderot-sielinou@131718107/voxkivreBackend@1367692888"
  github_environment      = "production"
  ecr_repository_arn      = module.registry.repository_arn
  image_tag_parameter_arn = module.app_config.image_tag_parameter_arn
  instance_arn            = module.app_ec2.instance_arn
  site_bucket_arn         = module.site.bucket_arn
  site_distribution_arn   = module.site.distribution_arn
}
