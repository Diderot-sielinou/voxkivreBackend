# Déploiement continu sans secret (ADR-0012, étape 4) : GitHub Actions
# obtient un rôle AWS temporaire par OIDC. Aucune clé AWS n'est stockée dans
# GitHub ; AWS vérifie le jeton signé par GitHub (émetteur, audience, et
# surtout `sub` = dépôt + environnement).

data "aws_caller_identity" "current" {}

locals {
  account_id = data.aws_caller_identity.current.account_id
  issuer     = "token.actions.githubusercontent.com"
}

# Le fournisseur d'identité « GitHub » du compte. AWS valide lui-même le
# certificat de GitHub : plus d'empreinte à maintenir.
resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://${local.issuer}"
  client_id_list = ["sts.amazonaws.com"]
}

resource "aws_iam_role" "deploy" {
  name                 = "${var.name}-github-deploy"
  max_session_duration = 3600

  # Seul un job du dépôt, dans l'environnement `production` (lui-même
  # réservé à la branche master côté GitHub), peut endosser ce rôle : ni
  # une PR, ni une autre branche, ni un fork. Le dépôt utilise le sujet
  # IMMUABLE de GitHub (propriétaire@id/dépôt@id) : un dépôt renommé puis
  # recréé sous le même nom par un tiers n'obtiendrait pas le rôle.
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = aws_iam_openid_connect_provider.github.arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "${local.issuer}:aud" = "sts.amazonaws.com"
          "${local.issuer}:sub" = "${var.github_subject_prefix}:environment:${var.github_environment}"
        }
      }
    }]
  })
}

# Moindre privilège : publier une image, désigner la version, déclencher le
# déploiement sur la seule instance. Ni secret, ni infrastructure.
resource "aws_iam_role_policy" "deploy" {
  name = "${var.name}-github-deploy"
  role = aws_iam_role.deploy.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "RegistryAuth" # docker login : pas de ressource possible
        Effect   = "Allow"
        Action   = "ecr:GetAuthorizationToken"
        Resource = "*"
      },
      {
        Sid    = "RegistryPushAndScan"
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:InitiateLayerUpload",
          "ecr:UploadLayerPart",
          "ecr:CompleteLayerUpload",
          "ecr:PutImage",
          "ecr:BatchGetImage",
          "ecr:DescribeImages",
          "ecr:DescribeImageScanFindings",
        ]
        Resource = var.ecr_repository_arn
      },
      {
        Sid      = "SelectVersion" # uniquement IMAGE_TAG, aucun autre paramètre
        Effect   = "Allow"
        Action   = "ssm:PutParameter"
        Resource = var.image_tag_parameter_arn
      },
      {
        Sid    = "RunDeployCommand"
        Effect = "Allow"
        Action = "ssm:SendCommand"
        Resource = [
          var.instance_arn,
          "arn:aws:ssm:${var.region}::document/AWS-RunShellScript",
        ]
      },
      {
        # Lecture seule, sans ressource possible : résultat de la commande,
        # état de l'instance (allumée ou non, retrouvée par son tag Name).
        Sid      = "ReadDeployState"
        Effect   = "Allow"
        Action   = ["ssm:GetCommandInvocation", "ec2:DescribeInstances"]
        Resource = "*"
      },
    ]
  })
}
