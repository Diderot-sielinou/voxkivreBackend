output "bucket_name" {
  description = "Bucket du site (secret GitHub SITE_BUCKET)."
  value       = aws_s3_bucket.this.bucket
}

output "bucket_arn" {
  description = "ARN du bucket (rôle de publication)."
  value       = aws_s3_bucket.this.arn
}

output "distribution_id" {
  description = "ID de la distribution (variable GitHub SITE_DISTRIBUTION_ID)."
  value       = aws_cloudfront_distribution.this.id
}

output "distribution_arn" {
  description = "ARN de la distribution (invalidation par le rôle de publication)."
  value       = aws_cloudfront_distribution.this.arn
}
