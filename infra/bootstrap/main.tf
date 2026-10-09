# Bucket de l'état Terraform de `envs/*` — lancé une seule fois, état LOCAL.
#
# Œuf et poule : le bucket d'état doit exister avant que `envs/main` puisse
# y ranger son état. Ce dossier le crée avec un état local (non versionné,
# cf. .gitignore) ; s'il est perdu, `terraform import` le reconstruit.
#
# Verrou : natif S3 (`use_lockfile = true` côté backend, Terraform ≥ 1.10),
# un fichier `.tflock` dans ce bucket — pas de table DynamoDB.

terraform {
  required_version = "~> 1.16"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.66.0"
    }
  }
}

variable "region" {
  description = "Région AWS du projet (ADR-0012 : Paris, la plus proche du Cameroun)."
  type        = string
  default     = "eu-west-3"
}

# Identifiants : chaîne par défaut du SDK (AWS_PROFILE=voxlivre en local).
provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project   = "voxlivre"
      Stack     = "bootstrap"
      ManagedBy = "terraform"
    }
  }
}

data "aws_caller_identity" "current" {}

locals {
  # Noms de bucket globaux : l'ID de compte garantit l'unicité sans être
  # écrit dans le dépôt (public).
  state_bucket = "voxlivre-tfstate-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket" "state" {
  bucket = local.state_bucket

  # Perdre l'état = Terraform ne sait plus ce qu'il gère.
  lifecycle {
    prevent_destroy = true
  }
}

# Versionné : revenir à un état précédent après une erreur.
resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket = aws_s3_bucket.state.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# L'état contient des secrets (ex. `random_password`) : HTTPS obligatoire.
resource "aws_s3_bucket_policy" "state" {
  bucket = aws_s3_bucket.state.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "DenyInsecureTransport"
      Effect    = "Deny"
      Principal = "*"
      Action    = "s3:*"
      Resource  = [aws_s3_bucket.state.arn, "${aws_s3_bucket.state.arn}/*"]
      Condition = { Bool = { "aws:SecureTransport" = "false" } }
    }]
  })

  depends_on = [aws_s3_bucket_public_access_block.state]
}

# Les anciennes versions de l'état ne servent qu'à un retour arrière récent.
resource "aws_s3_bucket_lifecycle_configuration" "state" {
  bucket = aws_s3_bucket.state.id

  rule {
    id     = "expire-old-state-versions"
    status = "Enabled"

    filter {}

    noncurrent_version_expiration {
      noncurrent_days = 90
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }

  depends_on = [aws_s3_bucket_versioning.state]
}

output "state_bucket" {
  description = "Bucket de l'état — à reporter dans envs/*/backend.hcl."
  value       = aws_s3_bucket.state.bucket
}
