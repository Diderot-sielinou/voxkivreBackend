variable "prefix" {
  description = "Préfixe SSM de l'environnement (ex. /voxlivre/main)."
  type        = string

  validation {
    condition     = can(regex("^/[a-z0-9/-]+[a-z0-9]$", var.prefix))
    error_message = "prefix doit commencer par / et ne pas finir par /."
  }
}

variable "environment" {
  description = "Nom de l'environnement (APP_ENV)."
  type        = string
}

variable "region" {
  description = "Région AWS (S3, Polly, SES)."
  type        = string
}

variable "domain" {
  description = "Nom de domaine public de l'API (HTTPS)."
  type        = string
}

variable "dns_zone_id" {
  description = "Zone Route 53 de DOMAIN : l'IP y est publiée au démarrage (ADR-0018)."
  type        = string
}

variable "bucket_name" {
  description = "Bucket applicatif (S3_BUCKET)."
  type        = string
}

variable "image_repository" {
  description = "URL du dépôt ECR de l'image voxlivre-api."
  type        = string
}

variable "otp_sender_email" {
  description = "Expéditeur des e-mails OTP (adresse du domaine vérifié dans SES, ADR-0018)."
  type        = string
}
