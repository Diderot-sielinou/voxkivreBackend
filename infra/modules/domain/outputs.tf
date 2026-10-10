output "name_servers" {
  description = "Serveurs de noms de la zone, à poser chez le registraire (Custom DNS)."
  value       = aws_route53_zone.this.name_servers
}

output "zone_id" {
  description = "ID de la zone (enregistrement de l'API mis à jour au démarrage)."
  value       = aws_route53_zone.this.zone_id
}

output "zone_arn" {
  description = "ARN de la zone (politique IAM de l'instance)."
  value       = aws_route53_zone.this.arn
}

output "ses_identity_arn" {
  description = "ARN de l'identité SES du domaine (ses:SendEmail)."
  value       = aws_sesv2_email_identity.this.arn
}
