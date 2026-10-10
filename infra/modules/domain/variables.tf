variable "domain_name" {
  description = "Domaine acheté chez le registraire (ex. voxlivre.store)."
  type        = string
}

variable "region" {
  description = "Région SES (point de retour des rebonds du MAIL FROM)."
  type        = string
}

variable "dmarc_policy" {
  description = "Politique DMARC : none (observation) puis quarantine (ADR-0018)."
  type        = string

  validation {
    condition     = contains(["none", "quarantine", "reject"], var.dmarc_policy)
    error_message = "dmarc_policy doit valoir none, quarantine ou reject."
  }
}
