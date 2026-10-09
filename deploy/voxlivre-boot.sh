#!/usr/bin/env bash
# Démarrage de voxlivre sur l'instance EC2 (ADR-0012), à CHAQUE boot, via
# voxlivre.service. Idempotent : le relancer ne casse rien.
#
#   1. monte le volume de données /data (formaté au tout premier boot) ;
#   2. écrit la configuration depuis SSM : app.env (API) + deploy.env (compose) ;
#   3. met à jour DuckDNS avec l'IP publique du moment (pas d'Elastic IP) ;
#   4. récupère deploy/ dans le bucket (compose, Caddyfile) ;
#   5. tire l'image, applique les migrations, démarre la stack.
#
# Pas de `set -x` : les valeurs lues dans SSM sont des secrets.
set -euo pipefail

# Valeurs posées par le user data (Terraform) : région, bucket, préfixe SSM,
# groupe de logs, ID du volume de données.
# shellcheck source=/dev/null
source /etc/voxlivre/instance.env

STACK_DIR=/opt/voxlivre
CONF_DIR=/etc/voxlivre
COMPOSE=(docker compose -f "$STACK_DIR/docker-compose.prod.yml"
  --env-file "$CONF_DIR/deploy.env" --env-file "$CONF_DIR/app.env")

log() { echo "voxlivre-boot: $*"; }

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

update_dns() {
  local response
  if [[ -z "${DUCKDNS_TOKEN:-}" ]]; then
    log "WARN DUCKDNS_TOKEN missing in SSM: DNS not updated"
    return
  fi
  # IP vide : DuckDNS retient l'IP source de la requête (notre IP publique).
  response="$(curl -fsS --max-time 20 --retry 3 \
    "https://www.duckdns.org/update?domains=${DUCKDNS_SUBDOMAIN}&token=${DUCKDNS_TOKEN}&ip=" || true)"
  if [[ "$response" == "OK" ]]; then
    log "DuckDNS updated"
  else
    log "WARN DuckDNS update failed"
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

mount_data_volume
write_config
# DOMAIN, DUCKDNS_*, IMAGE_REPOSITORY, IMAGE_TAG (SSM /voxlivre/main/deploy/*).
# shellcheck source=/dev/null
source "$CONF_DIR/deploy.env"
update_dns
fetch_stack_files
start_stack
