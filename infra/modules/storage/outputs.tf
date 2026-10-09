output "bucket_name" {
  description = "Nom du bucket (variable S3_BUCKET de l'API)."
  value       = aws_s3_bucket.this.bucket
}

output "bucket_arn" {
  description = "ARN du bucket (politique IAM du rôle d'instance)."
  value       = aws_s3_bucket.this.arn
}
