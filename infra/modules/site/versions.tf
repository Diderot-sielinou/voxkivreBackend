terraform {
  required_version = "~> 1.16"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.66.0"
      # CloudFront n'accepte que des certificats ACM de us-east-1.
      configuration_aliases = [aws.us_east_1]
    }
  }
}
