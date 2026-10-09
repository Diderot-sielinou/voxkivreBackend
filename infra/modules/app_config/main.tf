# Configuration de l'API et du déploiement dans SSM Parameter Store
# (ADR-0012), lue par voxlivre-boot.sh à chaque démarrage :
#   <prefix>/app/<VAR>    → /etc/voxlivre/app.env    (env de l'API, Zod)
#   <prefix>/deploy/<VAR> → /etc/voxlivre/deploy.env (compose, DNS)
#
# Secrets générés ici (`random_password`) : jamais écrits par un humain,
# présents dans l'état (bucket privé, chiffré, versionné). Seul le token
# DuckDNS est posé à la main (cf. infra/README.md) : il vient d'un compte
# tiers, Terraform ne le connaît pas.

locals {
  # Seules les variables qui diffèrent des défauts du schéma Zod
  # (src/shared/config/env.schema.ts) — rien « au cas où ».
  app_settings = {
    NODE_ENV          = "production"
    APP_ENV           = var.environment
    TRUST_PROXY_HOPS  = "1" # Caddy
    DB_HOST           = "postgres"
    DB_NAME           = "voxlivre"
    DB_USER           = "voxlivre"
    REDIS_HOST        = "redis"
    BETTER_AUTH_URL   = "https://${var.domain}"
    OTP_DELIVERY_MODE = "notification"
    OTP_EMAIL_FROM    = var.otp_sender_email
    S3_BUCKET         = var.bucket_name
    AWS_REGION        = var.region
    TTS_PROVIDER      = "polly"
  }

  deploy_settings = {
    DOMAIN            = var.domain
    DUCKDNS_SUBDOMAIN = var.duckdns_subdomain
    IMAGE_REPOSITORY  = var.image_repository
  }
}

resource "aws_ssm_parameter" "app" {
  for_each = local.app_settings

  name  = "${var.prefix}/app/${each.key}"
  type  = "String"
  value = each.value
}

resource "aws_ssm_parameter" "deploy" {
  for_each = local.deploy_settings

  name  = "${var.prefix}/deploy/${each.key}"
  type  = "String"
  value = each.value
}

# Étiquette de l'image déployée : « none » à la création (rien à démarrer),
# puis écrite par le déploiement (3c à la main, CI à l'étape 4). Terraform
# ne la réécrit jamais.
resource "aws_ssm_parameter" "image_tag" {
  name  = "${var.prefix}/deploy/IMAGE_TAG"
  type  = "String"
  value = "none"

  lifecycle {
    ignore_changes = [value]
  }
}

# --- Secrets ------------------------------------------------------------

# Alphanumériques : aucun échappement à prévoir dans les fichiers d'env.
resource "random_password" "secret" {
  for_each = toset(["DB_PASSWORD", "BETTER_AUTH_SECRET", "CURSOR_HMAC_SECRET"])

  length  = 48
  special = false
}

resource "aws_ssm_parameter" "secret" {
  for_each = random_password.secret

  name  = "${var.prefix}/app/${each.key}"
  type  = "SecureString" # chiffré par la clé KMS gérée aws/ssm
  value = each.value.result
}
