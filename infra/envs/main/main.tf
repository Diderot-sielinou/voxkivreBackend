# Environnement principal — phase 1 d'ADR-0012 (EC2 + Docker Compose).
# 3a : fondations sans calcul (réseau, stockage, registre). L'instance, son
# rôle et l'exploitation (logs, Scheduler, Budget, SSM) arrivent en 3b.

variable "region" {
  description = "Région AWS du projet (ADR-0012)."
  type        = string
  default     = "eu-west-3"
}

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

data "aws_caller_identity" "current" {}

locals {
  name = "voxlivre-main"
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
