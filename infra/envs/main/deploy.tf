# Fichiers de déploiement versionnés dans deploy/, publiés dans le bucket
# applicatif (préfixe deploy/) où l'instance les lit à chaque démarrage.
# Une modification → `apply` → effective au prochain boot (ou relance du
# service par SSM Run Command, étape 4).
locals {
  deploy_dir = "${path.root}/../../../deploy"

  deploy_files = {
    "docker-compose.prod.yml" = "application/yaml"
    "Caddyfile"               = "text/plain"
    "voxlivre-boot.sh"        = "text/x-shellscript"
    "voxlivre.service"        = "text/plain"
  }
}

resource "aws_s3_object" "deploy" {
  for_each = local.deploy_files

  bucket       = module.storage.bucket_name
  key          = "deploy/${each.key}"
  source       = "${local.deploy_dir}/${each.key}"
  content_type = each.value
  # Republie quand le fichier change.
  etag = filemd5("${local.deploy_dir}/${each.key}")
}
