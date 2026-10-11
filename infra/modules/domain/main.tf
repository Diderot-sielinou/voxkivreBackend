# Domaine du produit (ADR-0018) : zone DNS Route 53 et identité SES du
# domaine, avec les enregistrements qui authentifient les e-mails (DKIM,
# MAIL FROM/SPF, DMARC) et la réception de `contact@` (ADR-0020). La zone ne répond qu'une fois ses serveurs de noms
# posés chez le registraire (Namecheap) : sortie `name_servers`.

locals {
  mail_from_domain = "mail.${var.domain_name}"
}

resource "aws_route53_zone" "this" {
  name    = var.domain_name
  comment = "Domaine Voxlivre (ADR-0018)"
}

# Seuls Let's Encrypt (Caddy, API) et Amazon (ACM, page d'accueil servie par
# CloudFront — ADR-0020) peuvent émettre un certificat pour le domaine ;
# aucun certificat générique.
resource "aws_route53_record" "caa" {
  zone_id = aws_route53_zone.this.zone_id
  name    = var.domain_name
  type    = "CAA"
  ttl     = 3600
  records = [
    "0 issue \"letsencrypt.org\"",
    "0 issue \"amazon.com\"",
    "0 issuewild \";\"",
  ]
}

# --- E-mail : identité SES du domaine ----------------------------------------

resource "aws_sesv2_email_identity" "this" {
  email_identity = var.domain_name

  # Easy DKIM : SES signe chaque e-mail, la clé publique est publiée par les
  # trois CNAME ci-dessous (SES tourne les clés lui-même).
  dkim_signing_attributes {
    next_signing_key_length = "RSA_2048_BIT"
  }
}

resource "aws_route53_record" "dkim" {
  # Easy DKIM fournit toujours trois jetons.
  count = 3

  zone_id = aws_route53_zone.this.zone_id
  name    = "${aws_sesv2_email_identity.this.dkim_signing_attributes[0].tokens[count.index]}._domainkey.${var.domain_name}"
  type    = "CNAME"
  ttl     = 3600
  records = ["${aws_sesv2_email_identity.this.dkim_signing_attributes[0].tokens[count.index]}.dkim.amazonses.com"]
}

# Domaine d'enveloppe (MAIL FROM) sous le nôtre : SPF est vérifié sur
# `mail.<domaine>`, donc aligné pour DMARC, et Gmail n'affiche plus « via
# amazonses.com ». MX introuvable → SES revient à son domaine par défaut
# plutôt que de refuser l'envoi.
resource "aws_sesv2_email_identity_mail_from_attributes" "this" {
  email_identity         = aws_sesv2_email_identity.this.email_identity
  mail_from_domain       = local.mail_from_domain
  behavior_on_mx_failure = "USE_DEFAULT_VALUE"
}

# Les rebonds reviennent à SES par ce MX (point de retour de la région).
resource "aws_route53_record" "mail_from_mx" {
  zone_id = aws_route53_zone.this.zone_id
  name    = local.mail_from_domain
  type    = "MX"
  ttl     = 3600
  records = ["10 feedback-smtp.${var.region}.amazonses.com"]
}

resource "aws_route53_record" "mail_from_spf" {
  zone_id = aws_route53_zone.this.zone_id
  name    = local.mail_from_domain
  type    = "TXT"
  ttl     = 3600
  records = ["v=spf1 include:amazonses.com ~all"]
}

# DMARC en observation (`p=none`) ; `quarantine` une fois les premiers
# envois constatés `pass` (ADR-0018). Pas d'adresse de rapports : aucune
# boîte sur le domaine.
resource "aws_route53_record" "dmarc" {
  zone_id = aws_route53_zone.this.zone_id
  name    = "_dmarc.${var.domain_name}"
  type    = "TXT"
  ttl     = 3600
  records = ["v=DMARC1; p=${var.dmarc_policy}"]
}

# --- E-mail : réception (contact@) -------------------------------------------

# Le domaine nu reçoit le courrier par ImprovMX, qui le redirige vers la boîte
# du porteur (ADR-0020 ; alias déclarés dans son tableau de bord).
resource "aws_route53_record" "inbound_mx" {
  zone_id = aws_route53_zone.this.zone_id
  name    = var.domain_name
  type    = "MX"
  ttl     = 3600
  records = [
    "10 mx1.improvmx.com",
    "20 mx2.improvmx.com",
  ]
}

# ImprovMX réexpédie avec le domaine nu comme adresse de retour (SRS) : ce SPF
# l'autorise, sinon Gmail voit un envoi non autorisé pour `voxlivre.store` et
# classe les messages redirigés en spam. Les codes SES ne sont pas concernés
# (leur SPF est sur `mail.<domaine>`).
resource "aws_route53_record" "inbound_spf" {
  zone_id = aws_route53_zone.this.zone_id
  name    = var.domain_name
  type    = "TXT"
  ttl     = 3600
  records = ["v=spf1 include:spf.improvmx.com ~all"]
}
