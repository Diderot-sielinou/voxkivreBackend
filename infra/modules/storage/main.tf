# Bucket applicatif (ADR-0007, ADR-0012) : PDF temporaires, cache TTS,
# parties MP3 + WebVTT + manifestes. Privé ; le mobile n'y accède que par
# URL pré-signées émises par l'API (rôle d'instance, module app_ec2).
#
# Pas de règle CORS : l'app Flutter est native (CORS ne concerne que les
# navigateurs). Pas de versionnage : tout objet est régénérable ou à
# supprimer (PDF), et des versions conservées coûteraient sans servir.

resource "aws_s3_bucket" "this" {
  bucket = var.bucket_name

  # Audio déjà payé (Polly) : un `destroy` ne doit pas l'effacer.
  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_public_access_block" "this" {
  bucket = aws_s3_bucket.this.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "this" {
  bucket = aws_s3_bucket.this.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Les URL pré-signées et le SDK utilisent HTTPS : HTTP est refusé.
resource "aws_s3_bucket_policy" "this" {
  bucket = aws_s3_bucket.this.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "DenyInsecureTransport"
      Effect    = "Deny"
      Principal = "*"
      Action    = "s3:*"
      Resource  = [aws_s3_bucket.this.arn, "${aws_s3_bucket.this.arn}/*"]
      Condition = { Bool = { "aws:SecureTransport" = "false" } }
    }]
  })

  depends_on = [aws_s3_bucket_public_access_block.this]
}

resource "aws_s3_bucket_lifecycle_configuration" "this" {
  bucket = aws_s3_bucket.this.id

  # Filet de sécurité juridique (CdC §8) : l'API supprime le PDF source
  # après extraction et purge les imports abandonnés à 24 h ; si elle
  # échoue, S3 l'efface quand même.
  rule {
    id     = "expire-source-pdfs"
    status = "Enabled"

    filter {
      prefix = "documents/"
    }

    expiration {
      days = var.source_pdf_retention_days
    }
  }

  # Uploads multipart interrompus : invisibles mais facturés.
  rule {
    id     = "abort-incomplete-multipart"
    status = "Enabled"

    filter {}

    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}
