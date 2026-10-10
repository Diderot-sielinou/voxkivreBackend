variable "name" {
  description = "Préfixe des noms (ressources, tag Name, groupe de logs)."
  type        = string
}

variable "region" {
  description = "Région AWS."
  type        = string
}

variable "subnet_id" {
  description = "Sous-réseau public de l'instance (module network)."
  type        = string
}

variable "bucket_name" {
  description = "Bucket applicatif (fichiers deploy/ et données de l'API)."
  type        = string
}

variable "bucket_arn" {
  description = "ARN du bucket applicatif (politique du rôle)."
  type        = string
}

variable "ecr_repository_arn" {
  description = "ARN du dépôt ECR (lecture de l'image)."
  type        = string
}

variable "ses_identity_arns" {
  description = "Identités SES autorisées : le domaine expéditeur et, en bac à sable, le destinataire d'essai (ADR-0018)."
  type        = list(string)
}

variable "dns_zone_arn" {
  description = "ARN de la zone Route 53 où le script de boot publie l'IP (ADR-0018)."
  type        = string
}

variable "dns_record_name" {
  description = "Seul nom que l'instance peut modifier dans la zone (enregistrement A de l'API)."
  type        = string
}

variable "ssm_prefix" {
  description = "Préfixe SSM de la configuration (ex. /voxlivre/main)."
  type        = string
}

variable "root_volume_size_gb" {
  description = "Disque système (Go) : OS + images Docker."
  type        = number

  validation {
    condition     = var.root_volume_size_gb >= 8
    error_message = "L'AMI AL2023 exige au moins 8 Go."
  }
}

variable "data_volume_size_gb" {
  description = "Volume de données (Go) : Postgres, Redis, certificats."
  type        = number
}

variable "backup_tag" {
  description = "Étiquette du volume de données ciblée par la sauvegarde DLM (module ops)."
  type        = map(string)
}

variable "compose_version" {
  description = "Version du plugin Docker Compose (release GitHub, ex. v5.5.1)."
  type        = string
}

variable "compose_sha256_aarch64" {
  description = "SHA-256 officiel du binaire docker-compose-linux-aarch64 de cette version."
  type        = string

  validation {
    condition     = can(regex("^[0-9a-f]{64}$", var.compose_sha256_aarch64))
    error_message = "compose_sha256_aarch64 doit être une empreinte SHA-256 (64 caractères hexadécimaux)."
  }
}

variable "deploy_files_etags" {
  description = "Empreintes des fichiers deploy/ publiés : l'instance n'est créée qu'après eux."
  type        = map(string)
}
