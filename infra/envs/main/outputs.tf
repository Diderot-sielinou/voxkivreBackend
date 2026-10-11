output "vpc_id" {
  description = "ID du VPC."
  value       = module.network.vpc_id
}

output "public_subnet_id" {
  description = "Sous-réseau public (instance, 3b)."
  value       = module.network.public_subnet_id
}

output "bucket_name" {
  description = "Bucket applicatif (S3_BUCKET de l'API)."
  value       = module.storage.bucket_name
}

output "ecr_repository_url" {
  description = "Dépôt de l'image voxlivre-api."
  value       = module.registry.repository_url
}

output "instance_id" {
  description = "Instance de l'API (aws ssm start-session --target <id>)."
  value       = module.app_ec2.instance_id
}

output "api_url" {
  description = "URL publique de l'API."
  value       = "https://${local.domain}"
}

output "log_group_name" {
  description = "Logs des conteneurs (CloudWatch, 7 jours)."
  value       = module.app_ec2.log_group_name
}


output "deploy_role_arn" {
  description = "Rôle de déploiement GitHub Actions (à poser en secret de l'environnement production)."
  value       = module.cicd.deploy_role_arn
}

output "name_servers" {
  description = "Serveurs de noms de voxlivre.store, à poser chez Namecheap (Custom DNS, ADR-0018)."
  value       = module.domain.name_servers
}

output "site_bucket_name" {
  description = "Bucket de la page d'accueil (secret SITE_BUCKET de l'environnement production)."
  value       = module.site.bucket_name
  sensitive   = true # contient l'ID de compte
}

output "site_distribution_id" {
  description = "Distribution de la page d'accueil (variable SITE_DISTRIBUTION_ID de l'environnement production)."
  value       = module.site.distribution_id
}
