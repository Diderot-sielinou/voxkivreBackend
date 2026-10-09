# Réseau de la phase 1 (ADR-0012) : un VPC, UN sous-réseau public, aucune
# NAT Gateway (~32 $/mois). L'instance a une IPv4 publique ; ce sont les
# security groups (module app_ec2) qui ferment tout sauf 80/443.
#
# Un seul sous-réseau tant qu'une seule instance tourne : la phase 2 (RDS)
# et la vitrine (ALB) exigeront une seconde zone — on l'ajoutera alors.

data "aws_availability_zones" "available" {
  state = "available"
}

resource "aws_vpc" "this" {
  cidr_block = var.cidr_block

  # Résolution DNS interne (endpoints, noms d'hôte AWS).
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = { Name = "${var.name}-vpc" }
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id

  tags = { Name = "${var.name}-igw" }
}

resource "aws_subnet" "public" {
  vpc_id            = aws_vpc.this.id
  cidr_block        = cidrsubnet(var.cidr_block, 8, 1) # /24 dans le /16
  availability_zone = data.aws_availability_zones.available.names[0]

  # IP publique automatique au démarrage : pas d'Elastic IP (facturée
  # même instance éteinte) ; le DNS est mis à jour au boot (DuckDNS).
  map_public_ip_on_launch = true

  tags = { Name = "${var.name}-public-a" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.this.id
  }

  tags = { Name = "${var.name}-public-rt" }
}

resource "aws_route_table_association" "public" {
  subnet_id      = aws_subnet.public.id
  route_table_id = aws_route_table.public.id
}

# Endpoint S3 de type Gateway : gratuit ; le trafic instance → S3 reste
# sur le réseau AWS au lieu de sortir par Internet.
resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.this.id
  service_name      = "com.amazonaws.${var.region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [aws_route_table.public.id]

  tags = { Name = "${var.name}-s3-endpoint" }
}

# Le security group par défaut du VPC autorise tout entre ses membres :
# on le vide pour qu'une ressource oubliée sans SG explicite soit isolée.
resource "aws_default_security_group" "this" {
  vpc_id = aws_vpc.this.id

  tags = { Name = "${var.name}-default-sg-locked" }
}
