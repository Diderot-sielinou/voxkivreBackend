output "repository_url" {
  description = "URL du dépôt (docker push / pull)."
  value       = aws_ecr_repository.this.repository_url
}

output "repository_arn" {
  description = "ARN du dépôt (politiques IAM : lecture instance, écriture CI)."
  value       = aws_ecr_repository.this.arn
}
