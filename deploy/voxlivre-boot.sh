#!/usr/bin/env bash
# Démarrage de voxlivre sur l'instance EC2 (ADR-0012), à CHAQUE boot, via
# voxlivre.service — et à chaque déploiement, relancé par la CI (SSM Run
# Command) sans arrêter la stack. Idempotent : le relancer ne casse rien ;
# `compose up -d` ne recrée que les conteneurs dont l'image a changé (l'API).
#
#   0. ferme sshd (administration par Session Manager uniquement) ;
#   1. monte le volume de données /data (formaté au tout premier boot) ;
#   2. écrit la configuration depuis SSM : app.env (API) + deploy.env (compose) ;
#   3. publie l'IP publique du moment dans Route 53 (pas d'Elastic IP, ADR-0018) ;
#   4. récupère deploy/ dans le bucket (compose, Caddyfile) ;
#   5. tire l'image, applique les migrations, démarre la stack.
#
# Pas de `set -x` : les valeurs lues dans SSM sont des secrets.
set -euo pipefail

# Un seul passage à la fois : un déploiement qui arrive pendant le démarrage
# attend la fin de celui-ci (et inversement).
exec 9>/run/lock/voxlivre-boot.lock
flock 9

# Valeurs posées par le user data (Terraform) : région, bucket, préfixe SSM,
# groupe de logs, ID du volume de données.
# shellcheck source=/dev/null
source /etc/voxlivre/instance.env

STACK_DIR=/opt/voxlivre
CONF_DIR=/etc/voxlivre
COMPOSE=(docker compose -f "$STACK_DIR/docker-compose.prod.yml"
  --env-file "$CONF_DIR/deploy.env" --env-file "$CONF_DIR/app.env")

log() { echo "voxlivre-boot: $*"; }

# Défense en profondeur : le SG n'ouvre pas le port 22 et l'instance n'a
# aucune clé, mais AL2023 démarre sshd par défaut. Rien ne doit écouter
# sans raison ; l'administration passe par Session Manager (agent SSM).
# `mask` et non `disable` : cloud-init redémarre sshd à chaque boot (il en
# dépend) ; un service masqué ne peut plus être démarré par personne.
disable_sshd() {
  if [[ "$(systemctl is-enabled sshd.service 2>/dev/null)" != "masked" ]]; then
    systemctl mask --now sshd.service sshd.socket
    log "sshd masked (Session Manager only)"
  fi
}

mount_data_volume() {
  # Sur Nitro, le volume apparaît en NVMe ; son numéro de série est l'ID du
  # volume sans tiret — nom stable, contrairement à /dev/nvme1n1.
  local device="/dev/disk/by-id/nvme-Amazon_Elastic_Block_Store_${DATA_VOLUME_ID//-/}"
  local waited=0
  # Au premier boot, le volume est attaché juste après le démarrage.
  until [[ -e "$device" ]]; do
    if ((waited >= 300)); then
      log "data volume not attached after ${waited}s"
      exit 1
    fi
    sleep 5
    waited=$((waited + 5))
  done
  if ! blkid "$device" >/dev/null 2>&1; then
    log "formatting the data volume (first boot)"
    mkfs.xfs -L voxdata "$device" # étiquette XFS : 12 caractères max
  fi
  mkdir -p /data
  mountpoint -q /data || mount "$device" /data
  mkdir -p /data/postgres /data/redis /data/caddy
}

# /voxlivre/main/<groupe>/<NOM> → NOM=valeur (une ligne par paramètre).
write_env_from_ssm() {
  local group="$1" target="$2" tmp
  tmp="$(mktemp "$CONF_DIR/.env.XXXXXX")"
  chmod 600 "$tmp"
  aws ssm get-parameters-by-path --region "$AWS_REGION" \
    --path "$SSM_PREFIX/$group/" --recursive --with-decryption \
    --query 'Parameters[].[Name,Value]' --output text |
    while IFS=$'\t' read -r name value; do
      printf '%s=%s\n' "${name##*/}" "$value"
    done >"$tmp"
  mv "$tmp" "$target"
}

write_config() {
  mkdir -p "$CONF_DIR" && chmod 700 "$CONF_DIR"
  write_env_from_ssm app "$CONF_DIR/app.env"
  write_env_from_ssm deploy "$CONF_DIR/deploy.env"
  # Variables d'interpolation du compose propres à l'instance.
  printf 'AWS_REGION=%s\nLOG_GROUP=%s\n' "$AWS_REGION" "$LOG_GROUP" >>"$CONF_DIR/deploy.env"
}

# Enregistrement A de $DOMAIN → IP publique du moment (ADR-0018). Le rôle
# n'a le droit que de faire un UPSERT de ce seul nom, de type A. Un échec
# n'empêche pas le démarrage : l'ancienne IP reste publiée (alerte au journal).
update_dns() {
  local token ip batch change_id
  if [[ -z "${DNS_ZONE_ID:-}" ]]; then
    log "WARN DNS_ZONE_ID missing in SSM: DNS not updated"
    return
  fi
  token="$(curl -fsS --max-time 5 -X PUT http://169.254.169.254/latest/api/token \
    -H 'X-aws-ec2-metadata-token-ttl-seconds: 60' || true)"
  ip="$(curl -fsS --max-time 5 -H "X-aws-ec2-metadata-token: $token" \
    http://169.254.169.254/latest/meta-data/public-ipv4 || true)"
  if [[ ! "$ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    log "WARN no public IPv4 from the instance metadata: DNS not updated"
    return
  fi
  batch="$(printf '{"Changes":[{"Action":"UPSERT","ResourceRecordSet":{"Name":"%s","Type":"A","TTL":60,"ResourceRecords":[{"Value":"%s"}]}}]}' \
    "$DOMAIN" "$ip")"
  if ! change_id="$(aws route53 change-resource-record-sets --region "$AWS_REGION" \
    --hosted-zone-id "$DNS_ZONE_ID" --change-batch "$batch" \
    --query ChangeInfo.Id --output text)"; then
    log "WARN Route 53 update failed"
    return
  fi
  # Caddy demande son certificat juste après : attendre que les serveurs de
  # Route 53 servent la nouvelle IP (en général < 60 s).
  if timeout 120 aws route53 wait resource-record-sets-changed --region "$AWS_REGION" --id "$change_id"; then
    log "DNS $DOMAIN -> $ip"
  else
    log "WARN Route 53 change $change_id not confirmed within 120 s"
  fi
}

fetch_stack_files() {
  mkdir -p "$STACK_DIR"
  aws s3 cp --region "$AWS_REGION" --only-show-errors \
    "s3://$BUCKET/deploy/docker-compose.prod.yml" "$STACK_DIR/docker-compose.prod.yml"
  aws s3 cp --region "$AWS_REGION" --only-show-errors \
    "s3://$BUCKET/deploy/Caddyfile" "$STACK_DIR/Caddyfile"
}

start_stack() {
  if [[ "${IMAGE_TAG:-none}" == "none" ]]; then
    log "no image published yet (IMAGE_TAG=none): stack not started"
    return
  fi
  aws ecr get-login-password --region "$AWS_REGION" |
    docker login --username AWS --password-stdin "${IMAGE_REPOSITORY%%/*}" >/dev/null
  "${COMPOSE[@]}" pull --quiet
  "${COMPOSE[@]}" up -d --wait postgres redis
  # Migrations AVANT de servir le trafic (docs/code-engineering/migrations.md).
  "${COMPOSE[@]}" run --rm --no-deps api node dist/migrate
  "${COMPOSE[@]}" up -d --remove-orphans
  log "stack started (image ${IMAGE_TAG})"
}

disable_sshd
mount_data_volume
write_config
# DOMAIN, DNS_ZONE_ID, IMAGE_REPOSITORY, IMAGE_TAG (SSM /voxlivre/main/deploy/*).
# shellcheck source=/dev/null
source "$CONF_DIR/deploy.env"
update_dns
fetch_stack_files
start_stack
