output "ssm_prefix" {
  description = "Préfixe des paramètres (politique IAM de l'instance, script de boot)."
  value       = var.prefix
}

output "image_tag_parameter_arn" {
  description = "ARN du paramètre IMAGE_TAG (rôle de déploiement de la CI)."
  value       = aws_ssm_parameter.image_tag.arn
}
