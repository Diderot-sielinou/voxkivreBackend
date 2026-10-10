output "deploy_role_arn" {
  description = "Rôle endossé par GitHub Actions (secret AWS_DEPLOY_ROLE_ARN de l'environnement)."
  value       = aws_iam_role.deploy.arn
}
