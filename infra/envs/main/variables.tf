variable "region" {
  description = "Région AWS du projet (ADR-0012)."
  type        = string
  default     = "eu-west-3"
}

# Adresses personnelles : dans terraform.tfvars (non versionné), jamais dans
# le dépôt public.
variable "sandbox_recipient_email" {
  description = "Adresse du porteur, identité SES vérifiée : seul destinataire possible tant que SES est en bac à sable (ADR-0018)."
  type        = string

  validation {
    condition     = can(regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", var.sandbox_recipient_email))
    error_message = "sandbox_recipient_email doit être une adresse e-mail."
  }
}

variable "budget_alert_email" {
  description = "Destinataire des alertes du budget mensuel."
  type        = string

  validation {
    condition     = can(regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", var.budget_alert_email))
    error_message = "budget_alert_email doit être une adresse e-mail."
  }
}
