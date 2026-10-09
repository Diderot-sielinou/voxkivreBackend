variable "name" {
  description = "Préfixe des noms (tag Name)."
  type        = string
}

variable "region" {
  description = "Région AWS (nom du service de l'endpoint S3)."
  type        = string
}

variable "cidr_block" {
  description = "Plage IPv4 du VPC (/16)."
  type        = string

  validation {
    condition     = can(cidrhost(var.cidr_block, 0)) && endswith(var.cidr_block, "/16")
    error_message = "cidr_block doit être un bloc IPv4 /16 (ex. 10.20.0.0/16)."
  }
}
