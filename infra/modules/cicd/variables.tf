variable "name" {
  description = "Préfixe des noms."
  type        = string
}

variable "region" {
  description = "Région AWS (document SSM AWS-RunShellScript)."
  type        = string
}

variable "github_repository" {
  description = "Dépôt autorisé à déployer (propriétaire/nom)."
  type        = string

  validation {
    condition     = can(regex("^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", var.github_repository))
    error_message = "github_repository doit être de la forme propriétaire/nom."
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
