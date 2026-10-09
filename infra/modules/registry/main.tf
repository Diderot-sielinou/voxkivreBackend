# Registre de l'image voxlivre-api (arm64). La CI (étape 4) y pousse une
# image étiquetée par le SHA du commit ; l'instance la tire par son rôle.

resource "aws_ecr_repository" "this" {
  name = var.repository_name

  # Une étiquette (SHA) désigne pour toujours la même image : un
  # déploiement est reproductible et un retour arrière sûr.
  image_tag_mutability = "IMMUTABLE"

  # Analyse de vulnérabilités de base à chaque push (gratuite).
  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }
}

# Stockage ECR facturé au-delà de 500 Mo : on ne garde que les dernières
# images (retour arrière possible), et on purge vite les couches orphelines.
resource "aws_ecr_lifecycle_policy" "this" {
  repository = aws_ecr_repository.this.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Images sans étiquette (builds interrompus, étiquettes remplacées)"
        selection = {
          tagStatus   = "untagged"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = 1
        }
        action = { type = "expire" }
      },
      {
        rulePriority = 2
        description  = "Garder les ${var.images_to_keep} dernières images"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = var.images_to_keep
        }
        action = { type = "expire" }
      },
    ]
  })
}
