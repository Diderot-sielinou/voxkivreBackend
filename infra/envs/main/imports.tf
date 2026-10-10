# Ressources créées à la main avant Terraform (étapes 0 et 2), reprises en
# gestion : le plan doit les annoncer « imported », sans les recréer. Ces
# blocs restent comme trace ; ils sont sans effet une fois l'import fait.

import {
  to = module.ops.aws_budgets_budget.monthly
  id = "${data.aws_caller_identity.current.account_id}:My Monthly Cost Budget"
}

import {
  to = aws_sesv2_email_identity.sandbox_recipient
  id = var.sandbox_recipient_email
}
