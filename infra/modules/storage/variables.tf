variable "bucket_name" {
  description = "Nom (global) du bucket applicatif."
  type        = string
}

variable "source_pdf_retention_days" {
  description = "Âge (jours) au-delà duquel S3 efface un PDF source oublié sous documents/."
  type        = number

  validation {
    # Au-dessus de la purge applicative (24 h) pour ne jamais la devancer.
    condition     = var.source_pdf_retention_days >= 2
    error_message = "source_pdf_retention_days doit valoir au moins 2 (la purge applicative est à 24 h)."
  }
}
