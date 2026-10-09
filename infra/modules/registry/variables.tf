variable "repository_name" {
  description = "Nom du dépôt ECR."
  type        = string
}

variable "images_to_keep" {
  description = "Nombre d'images conservées (retours arrière possibles)."
  type        = number

  validation {
    condition     = var.images_to_keep >= 2
    error_message = "images_to_keep doit valoir au moins 2 (l'image courante + une de retour arrière)."
  }
}
