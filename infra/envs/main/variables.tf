variable "region" {
  description = "Région AWS du projet (ADR-0012)."
  type        = string
  default     = "eu-west-3"
}

variable "duckdns_subdomain" {
  description = "Sous-domaine DuckDNS réservé (sans .duckdns.org)."
  type        = string
}

# Adresses personnelles : dans terraform.tfvars (non versionné), jamais dans
# le dépôt public.
variable "otp_sender_email" {
  description = "Expéditeur des e-mails OTP : identité SES vérifiée (ADR-0014)."
  type        = string

  validation {
    condition     = can(regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", var.otp_sender_email))
    error_message = "otp_sender_email doit être une adresse e-mail."
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
