variable "name" {
  description = "Préfixe des noms."
  type        = string
}

variable "region" {
  description = "Région AWS (document SSM AWS-RunShellScript)."
  type        = string
}

variable "github_subject_prefix" {
  description = "Préfixe du sujet OIDC du dépôt autorisé, tel que GitHub l'émet (`gh api repos/<dépôt>/actions/oidc/customization/sub` → sub_claim_prefix)."
  type        = string

  validation {
    # Sujet immuable : repo:<propriétaire>@<id>/<dépôt>@<id>
    condition     = can(regex("^repo:[A-Za-z0-9_.-]+@[0-9]+/[A-Za-z0-9_.-]+@[0-9]+$", var.github_subject_prefix))
    error_message = "github_subject_prefix doit être de la forme repo:<propriétaire>@<id>/<dépôt>@<id> (sujet immuable GitHub)."
  }
}

variable "github_environment" {
  description = "Environnement GitHub autorisé (réservé à master côté GitHub)."
  type        = string
}

variable "ecr_repository_arn" {
  description = "Dépôt ECR où publier l'image."
  type        = string
}

variable "image_tag_parameter_arn" {
  description = "ARN du paramètre SSM IMAGE_TAG (seul paramètre modifiable)."
  type        = string
}

variable "instance_arn" {
  description = "Seule instance où lancer la commande de déploiement."
  type        = string
}
