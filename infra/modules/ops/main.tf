# Exploitation de la phase 1 (ADR-0012) : horaires de l'instance,
# sauvegardes du volume de données, budget, réputation d'envoi SES (ADR-0018).

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
      subscriber_email_addresses = [var.alert_email]
    }
  }
}

# --- Réputation d'envoi SES (ADR-0018) ---------------------------------------
# SES publie pour le compte (dans la région) un taux de rebond et un taux de
# plainte. Au-delà de 5 % de rebonds ou 0,1 % de plaintes, AWS place le
# compte « en revue » ; au-delà de 10 % / 0,5 %, il peut suspendre l'envoi —
# plus aucun code par e-mail. Les alarmes préviennent AVANT la revue.
# Sans envoi, pas de donnée : l'alarme reste OK (`notBreaching`).

resource "aws_sns_topic" "alerts" {
  name = "${var.name}-alerts"
}

# Abonnement à confirmer une fois par le lien reçu par e-mail.
resource "aws_sns_topic_subscription" "alerts_email" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

resource "aws_cloudwatch_metric_alarm" "ses_reputation" {
  for_each = {
    bounce = {
      metric    = "Reputation.BounceRate"
      threshold = 0.04 # revue AWS à 0,05
      label     = "rebonds"
    }
    complaint = {
      metric    = "Reputation.ComplaintRate"
      threshold = 0.0008 # revue AWS à 0,001
      label     = "plaintes"
    }
  }

  alarm_name          = "${var.name}-ses-${each.key}-rate"
  alarm_description   = "Taux de ${each.value.label} SES proche du seuil de revue AWS : envoi des codes par e-mail menacé (ADR-0018)."
  namespace           = "AWS/SES"
  metric_name         = each.value.metric
  statistic           = "Maximum"
  period              = 3600
  evaluation_periods  = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = each.value.threshold
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}
