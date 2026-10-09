output "vpc_id" {
  description = "ID du VPC."
  value       = aws_vpc.this.id
}

output "public_subnet_id" {
  description = "Sous-réseau public de l'instance."
  value       = aws_subnet.public.id
}
