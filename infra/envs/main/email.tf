# Identité SES expéditrice des OTP (ADR-0014). Vérifiée à la main
# (e-mail de confirmation) le 2026-10-08, importée ici (imports.tf). Le
# compte SES reste en bac à sable : envoi vers des adresses vérifiées
# seulement, jusqu'à la demande d'accès production.
resource "aws_sesv2_email_identity" "otp_sender" {
  email_identity = var.otp_sender_email
}
