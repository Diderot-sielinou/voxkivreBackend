# Adresse du porteur, vérifiée à la main le 2026-10-08 (imports.tf). Elle
# était l'expéditeur des OTP (ADR-0014) ; depuis ADR-0018 les codes partent
# du domaine (module domain) et elle ne sert plus que de destinataire
# d'essai, tant que le compte SES est en bac à sable.
resource "aws_sesv2_email_identity" "sandbox_recipient" {
  email_identity = var.sandbox_recipient_email
}

# Renommage sans recréer l'identité (sinon nouvelle vérification par e-mail).
moved {
  from = aws_sesv2_email_identity.otp_sender
  to   = aws_sesv2_email_identity.sandbox_recipient
}
