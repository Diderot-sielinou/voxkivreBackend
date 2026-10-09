terraform {
  required_version = "~> 1.16"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.66.0"
    }
  }

  # État distant, verrou natif S3 (`.tflock`). Configuration partielle : le
  # nom du bucket (contient l'ID de compte) vient de `backend.hcl`, non
  # versionné — cf. backend.hcl.example et infra/README.md.
  backend "s3" {
    key          = "envs/main/terraform.tfstate"
    region       = "eu-west-3"
    encrypt      = true
    use_lockfile = true
  }
}
