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
