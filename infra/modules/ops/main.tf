# Exploitation de la phase 1 (ADR-0012) : horaires de l'instance,
# sauvegardes du volume de données, budget.

# --- Démarrage / arrêt programmés (EventBridge Scheduler) -------------------

resource "aws_iam_role" "scheduler" {
  name = "${var.name}-scheduler"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "scheduler.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

# Uniquement démarrer / arrêter CETTE instance.
resource "aws_iam_role_policy" "scheduler" {
  name = "${var.name}-start-stop"
  role = aws_iam_role.scheduler.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["ec2:StartInstances", "ec2:StopInstances"]
      Resource = var.instance_arn
    }]
  })
}

locals {
  # Cibles « universelles » du Scheduler : un appel d'API AWS direct, sans Lambda.
  schedules = {
    start = { cron = var.start_cron, action = "startInstances" }
    stop  = { cron = var.stop_cron, action = "stopInstances" }
  }
}

resource "aws_scheduler_schedule" "this" {
  for_each = local.schedules

  name                         = "${var.name}-${each.key}"
  schedule_expression          = "cron(${each.value.cron})"
  schedule_expression_timezone = var.timezone

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = "arn:aws:scheduler:::aws-sdk:ec2:${each.value.action}"
    role_arn = aws_iam_role.scheduler.arn
    input    = jsonencode({ InstanceIds = [var.instance_id] })
  }
}

# --- Sauvegardes du volume de données (Data Lifecycle Manager) --------------

resource "aws_iam_role" "dlm" {
  name = "${var.name}-dlm"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "dlm.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "dlm" {
  role       = aws_iam_role.dlm.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSDataLifecycleManagerServiceRole"
}

# Snapshot quotidien (incrémental) des volumes portant `backup_tag` ;
# fonctionne aussi instance arrêtée.
resource "aws_dlm_lifecycle_policy" "data" {
  description        = "${var.name} daily data volume snapshots"
  execution_role_arn = aws_iam_role.dlm.arn
  state              = "ENABLED"

  policy_details {
    resource_types = ["VOLUME"]
    target_tags    = var.backup_tag

    schedule {
      name      = "daily"
      copy_tags = true

      create_rule {
        interval      = 24
        interval_unit = "HOURS"
        times         = [var.backup_time_utc]
      }

      retain_rule {
        count = var.backup_retention_count
      }
    }
  }
}

# --- Budget -------------------------------------------------------------------
# Créé à la main à l'étape 0, importé ici (envs/main/imports.tf) : nom,
# filtre et vue identiques à l'original pour que l'import corresponde.

data "aws_caller_identity" "current" {}

resource "aws_budgets_budget" "monthly" {
  name             = var.budget_name
  budget_type      = "COST"
  limit_amount     = var.budget_limit_usd
  limit_unit       = "USD"
  time_unit        = "MONTHLY"
  metrics          = ["UnblendedCost"]
  billing_view_arn = "arn:aws:billing::${data.aws_caller_identity.current.account_id}:billingview/primary"

  # Dépense RÉELLE, avant crédits : les crédits promotionnels couvrent tout
  # jusqu'en avril 2027 ; sans ce filtre le coût net resterait à 0 $ et
  # aucune alerte ne partirait jamais.
  filter_expression {
    not {
      dimensions {
        key    = "RECORD_TYPE"
        values = ["Credit", "Refund"]
      }
    }
  }

  dynamic "notification" {
    for_each = {
      actual-85      = { type = "ACTUAL", threshold = 85 }
      actual-100     = { type = "ACTUAL", threshold = 100 }
      forecasted-100 = { type = "FORECASTED", threshold = 100 }
    }

    content {
      notification_type          = notification.value.type
      comparison_operator        = "GREATER_THAN"
      threshold                  = notification.value.threshold
      threshold_type             = "PERCENTAGE"
      subscriber_email_addresses = [var.budget_alert_email]
    }
  }
}
