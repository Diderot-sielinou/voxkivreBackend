# L'instance de la phase 1 (ADR-0012) : t4g.small (Graviton), Amazon Linux
# 2023 arm64, Docker Compose. Aucun port d'administration : Session Manager
# (SSM) à la place de SSH. Aucune clé : le rôle d'instance fournit les
# identifiants à l'API (S3, Polly, SES), au script de boot (SSM, ECR) et au
# pilote de logs Docker (CloudWatch).

data "aws_caller_identity" "current" {}

data "aws_subnet" "this" {
  id = var.subnet_id
}

# AMI : dernière AL2023 arm64 au moment de la création ; figée ensuite
# (lifecycle de l'instance) pour qu'une nouvelle AMI ne remplace pas la
# machine à l'improviste.
data "aws_ssm_parameter" "al2023_arm64" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64"
}

locals {
  account_id = data.aws_caller_identity.current.account_id
}

# --- Réseau ---------------------------------------------------------------

resource "aws_security_group" "this" {
  name        = "${var.name}-app"
  description = "voxlivre API: HTTP/HTTPS in (Caddy), all out"
  vpc_id      = data.aws_subnet.this.vpc_id

  tags = { Name = "${var.name}-app" }
}

# 80 : défi Let's Encrypt + redirection vers HTTPS. 443 : l'API.
resource "aws_vpc_security_group_ingress_rule" "web" {
  for_each = toset(["80", "443"])

  security_group_id = aws_security_group.this.id
  description       = "Public ${each.key}/tcp"
  ip_protocol       = "tcp"
  from_port         = tonumber(each.key)
  to_port           = tonumber(each.key)
  cidr_ipv4         = "0.0.0.0/0"
}

# Sortie libre : Polly, SES, SSM, ECR, Route 53, Let's Encrypt, dépôts dnf.
resource "aws_vpc_security_group_egress_rule" "all" {
  security_group_id = aws_security_group.this.id
  description       = "All outbound"
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}

# --- Logs -----------------------------------------------------------------

resource "aws_cloudwatch_log_group" "this" {
  name              = "/${var.name}/app"
  retention_in_days = 7 # sans rétention, les logs s'accumulent (et se paient) sans fin
}

# --- Rôle de l'instance (moindre privilège) -------------------------------

resource "aws_iam_role" "this" {
  name = "${var.name}-instance"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

# Session Manager (shell sans SSH) et Run Command (déploiement, étape 4).
resource "aws_iam_role_policy_attachment" "ssm_core" {
  role       = aws_iam_role.this.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

# Chaque droit correspond à un appel du code ou du script de boot.
resource "aws_iam_role_policy" "app" {
  name = "${var.name}-app"
  role = aws_iam_role.this.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "AppObjects" # ObjectStoragePort : put, get, head, delete, URL signées
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = "${var.bucket_arn}/*"
      },
      {
        # Sans ListBucket, S3 répond 403 (et non 404) pour une clé absente :
        # `head` prendrait un objet manquant pour une panne du stockage.
        Sid      = "AppBucketList"
        Effect   = "Allow"
        Action   = "s3:ListBucket"
        Resource = var.bucket_arn
      },
      {
        Sid      = "Tts" # audio + Speech Marks (ADR-0013) ; Polly n'a pas de ressource
        Effect   = "Allow"
        Action   = "polly:SynthesizeSpeech"
        Resource = "*"
      },
      {
        # ADR-0018 : identités vérifiées seulement. En bac à sable, SES
        # contrôle aussi l'identité du destinataire.
        Sid      = "OtpEmail"
        Effect   = "Allow"
        Action   = "ses:SendEmail"
        Resource = var.ses_identity_arns
      },
      {
        # voxlivre-boot.sh : UPSERT de l'enregistrement A de l'API, et RIEN
        # d'autre dans la zone. `Null` = false : ForAllValues serait vrai
        # pour une requête sans la clé.
        Sid      = "Dns"
        Effect   = "Allow"
        Action   = "route53:ChangeResourceRecordSets"
        Resource = var.dns_zone_arn
        Condition = {
          "ForAllValues:StringEquals" = {
            "route53:ChangeResourceRecordSetsNormalizedRecordNames" = [var.dns_record_name]
            "route53:ChangeResourceRecordSetsRecordTypes"           = ["A"]
            "route53:ChangeResourceRecordSetsActions"               = ["UPSERT"]
          }
          Null = {
            "route53:ChangeResourceRecordSetsNormalizedRecordNames" = "false"
            "route53:ChangeResourceRecordSetsRecordTypes"           = "false"
            "route53:ChangeResourceRecordSetsActions"               = "false"
          }
        }
      },
      {
        Sid      = "DnsChangeStatus" # `aws route53 wait resource-record-sets-changed`
        Effect   = "Allow"
        Action   = "route53:GetChange"
        Resource = "arn:aws:route53:::change/*"
      },
      {
        Sid    = "Config" # voxlivre-boot.sh ; SecureString via la clé gérée aws/ssm
        Effect = "Allow"
        Action = ["ssm:GetParametersByPath", "ssm:GetParameters", "ssm:GetParameter"]
        Resource = [
          "arn:aws:ssm:${var.region}:${local.account_id}:parameter${var.ssm_prefix}",
          "arn:aws:ssm:${var.region}:${local.account_id}:parameter${var.ssm_prefix}/*",
        ]
      },
      {
        Sid      = "RegistryAuth" # jeton docker login : pas de ressource possible
        Effect   = "Allow"
        Action   = "ecr:GetAuthorizationToken"
        Resource = "*"
      },
      {
        Sid      = "RegistryPull"
        Effect   = "Allow"
        Action   = ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer", "ecr:BatchCheckLayerAvailability"]
        Resource = var.ecr_repository_arn
      },
      {
        Sid      = "Logs" # pilote Docker awslogs
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${aws_cloudwatch_log_group.this.arn}:*"
      },
    ]
  })
}

resource "aws_iam_instance_profile" "this" {
  name = "${var.name}-instance"
  role = aws_iam_role.this.name
}

# --- Données ---------------------------------------------------------------

# Volume séparé pour Postgres, Redis et les certificats : il survit au
# remplacement de l'instance. Sauvegardé chaque nuit (module ops, DLM) grâce
# à l'étiquette `backup_tag`.
resource "aws_ebs_volume" "data" {
  availability_zone = data.aws_subnet.this.availability_zone
  size              = var.data_volume_size_gb
  type              = "gp3"
  encrypted         = true

  tags = merge({ Name = "${var.name}-data" }, var.backup_tag)

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_volume_attachment" "data" {
  device_name = "/dev/sdf"
  volume_id   = aws_ebs_volume.data.id
  instance_id = aws_instance.this.id

  # Détachement propre : arrêter l'instance plutôt qu'arracher le disque.
  stop_instance_before_detaching = true
}

# --- Instance ----------------------------------------------------------------

# Point d'ordonnancement : existe une fois les fichiers deploy/ publiés.
# Mis à jour quand ils changent, sans toucher à l'instance (un `depends_on`
# ordonne, il ne remplace pas).
resource "terraform_data" "deploy_files" {
  input = var.deploy_files_etags
}

resource "aws_instance" "this" {
  ami                    = data.aws_ssm_parameter.al2023_arm64.insecure_value
  instance_type          = "t4g.small"
  subnet_id              = var.subnet_id
  vpc_security_group_ids = [aws_security_group.this.id]
  iam_instance_profile   = aws_iam_instance_profile.this.name

  # Crédits CPU « standard » : pas de surfacturation si la machine dépasse
  # son niveau de base (le défaut des t4g est « unlimited », payant).
  credit_specification {
    cpu_credits = "standard"
  }

  metadata_options {
    http_endpoint = "enabled"
    http_tokens   = "required" # IMDSv2 uniquement
    # 2 sauts : les conteneurs (pont Docker) sont un saut plus loin que
    # l'hôte. Avec 1, l'API n'obtiendrait pas les identifiants du rôle.
    http_put_response_hop_limit = 2
  }

  root_block_device {
    volume_type           = "gp3"
    volume_size           = var.root_volume_size_gb # système + images Docker
    encrypted             = true
    delete_on_termination = true
  }

  user_data = templatefile("${path.module}/user-data.sh.tftpl", {
    region                 = var.region
    bucket                 = var.bucket_name
    ssm_prefix             = var.ssm_prefix
    log_group              = aws_cloudwatch_log_group.this.name
    data_volume_id         = aws_ebs_volume.data.id
    compose_version        = var.compose_version
    compose_sha256_aarch64 = var.compose_sha256_aarch64
  })

  tags = { Name = "${var.name}-app" }

  lifecycle {
    ignore_changes = [ami]
  }

  depends_on = [terraform_data.deploy_files]
}
