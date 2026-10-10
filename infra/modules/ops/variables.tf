variable "name" {
  description = "Préfixe des noms."
  type        = string
}

variable "instance_id" {
  description = "Instance à démarrer / arrêter."
  type        = string
}

variable "instance_arn" {
  description = "ARN de l'instance (politique du Scheduler)."
  type        = string
}

variable "timezone" {
  description = "Fuseau des horaires (IANA)."
  type        = string
}

variable "start_cron" {
  description = "Démarrage : expression cron du Scheduler, sans `cron()` (ex. « 0 8 * * ? * »)."
  type        = string
}

variable "stop_cron" {
  description = "Arrêt : expression cron du Scheduler, sans `cron()`."
  type        = string
}

variable "backup_tag" {
  description = "Étiquette des volumes à sauvegarder."
  type        = map(string)
}

variable "backup_time_utc" {
  description = "Heure du snapshot quotidien, en UTC (HH:MM) — DLM n'a pas de fuseau."
  type        = string

  validation {
    condition     = can(regex("^([01][0-9]|2[0-3]):[0-5][0-9]$", var.backup_time_utc))
    error_message = "backup_time_utc doit être au format HH:MM."
  }
}

variable "backup_retention_count" {
  description = "Nombre de snapshots quotidiens conservés."
  type        = number
}

variable "budget_name" {
  description = "Nom du budget (celui créé à la main, pour l'import)."
  type        = string
}

variable "budget_limit_usd" {
  description = "Plafond mensuel (USD) ; alertes à 85 %, 100 % et 100 % prévu."
  type        = string
}

variable "alert_email" {
  description = "Destinataire des alertes : budget et réputation SES."
  type        = string
}
