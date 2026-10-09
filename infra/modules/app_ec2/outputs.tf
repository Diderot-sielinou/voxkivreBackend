output "instance_id" {
  description = "ID de l'instance (Scheduler, Session Manager)."
  value       = aws_instance.this.id
}

output "instance_arn" {
  description = "ARN de l'instance (politique du Scheduler)."
  value       = aws_instance.this.arn
}

output "log_group_name" {
  description = "Groupe CloudWatch des logs des conteneurs."
  value       = aws_cloudwatch_log_group.this.name
}
