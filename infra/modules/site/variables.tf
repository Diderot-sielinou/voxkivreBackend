variable "name" {
  description = "Préfixe des noms (fonction, OAC, politiques CloudFront)."
  type        = string
}

variable "bucket_name" {
  description = "Bucket du site, distinct du bucket applicatif (ADR-0020)."
  type        = string
}

variable "domain_name" {
  description = "Domaine nu servi par le site (ex. voxlivre.store) ; `www.` y est redirigé."
  type        = string
}

variable "zone_id" {
  description = "Zone Route 53 du domaine (validation ACM, alias)."
  type        = string
}
