#!/usr/bin/env bash
# Déploie une image DÉJÀ publiée dans ECR sur l'instance de production
# (ADR-0012, étape 4). Appelé par le job Deploy de ci.yml après le push de
# l'image, et par redeploy.yml (retour arrière) avec une étiquette existante.
#
#   deploy.sh <image-tag>
#
# Prérequis : identifiants AWS (rôle OIDC), AWS_REGION, API_URL.
# Étapes : scan ECR (bloquant si CRITICAL) → IMAGE_TAG dans SSM → si
# l'instance tourne : relance du script de boot par SSM Run Command (seule
# l'API est recréée) → vérification. Instance éteinte : la version sera
# prise au prochain démarrage.
set -euo pipefail

TAG="${1:?usage: deploy.sh <image-tag>}"
: "${AWS_REGION:?}" "${API_URL:?}"
REPOSITORY=voxlivre-api
PARAMETER=/voxlivre/main/deploy/IMAGE_TAG
INSTANCE_NAME=voxlivre-main-app

notice() { echo "::notice::$*"; }
fail() {
  echo "::error::$*"
  exit 1
}

# --- 1. Scan de l'image ------------------------------------------------------
# Le scan n'existe que quelques secondes après le push : on réessaie.
scan_status=""
for _ in $(seq 1 60); do
  scan_status="$(aws ecr describe-image-scan-findings --repository-name "$REPOSITORY" \
    --image-id imageTag="$TAG" --query imageScanStatus.status --output text 2>/dev/null || true)"
  [[ "$scan_status" == "COMPLETE" || "$scan_status" == "FAILED" ]] && break
  sleep 5
done
[[ "$scan_status" == "COMPLETE" ]] || fail "ECR scan of $TAG not complete (status: ${scan_status:-none})"

counts="$(aws ecr describe-image-scan-findings --repository-name "$REPOSITORY" \
  --image-id imageTag="$TAG" --query imageScanFindings.findingSeverityCounts --output json)"
echo "Scan $TAG: $counts"
critical="$(jq -r '.CRITICAL // 0' <<<"$counts")"
((critical == 0)) || fail "$critical CRITICAL finding(s) in $TAG: not deployed"

# --- 2. Désigner la version -----------------------------------------------------
aws ssm put-parameter --name "$PARAMETER" --type String --value "$TAG" --overwrite >/dev/null
echo "IMAGE_TAG=$TAG"

# --- 3. Instance allumée ? -------------------------------------------------------
read -r instance_id state < <(aws ec2 describe-instances \
  --filters "Name=tag:Name,Values=$INSTANCE_NAME" \
  "Name=instance-state-name,Values=pending,running,stopping,stopped" \
  --query 'Reservations[0].Instances[0].[InstanceId,State.Name]' --output text)
[[ -n "$instance_id" && "$instance_id" != "None" ]] || fail "instance $INSTANCE_NAME not found"

if [[ "$state" != "running" ]]; then
  notice "Instance $state: $TAG will be deployed at its next start (Scheduler, 08:00 Africa/Douala)"
  exit 0
fi

# --- 4. Relancer la stack sans l'arrêter --------------------------------------
# Script de boot retéléchargé (dernière version), puis exécuté : config SSM,
# pull, migrations, `up -d` (ne recrée que l'API). Il attend la fin d'un
# démarrage en cours (verrou).
# shellcheck disable=SC2016 # $AWS_REGION/$BUCKET : développés SUR L'INSTANCE (instance.env)
commands='[
  "set -euo pipefail",
  "source /etc/voxlivre/instance.env",
  "aws s3 cp --region \"$AWS_REGION\" --only-show-errors \"s3://$BUCKET/deploy/voxlivre-boot.sh\" /usr/local/bin/voxlivre-boot.sh",
  "chmod 755 /usr/local/bin/voxlivre-boot.sh",
  "/usr/local/bin/voxlivre-boot.sh"
]'
command_id="$(aws ssm send-command --instance-ids "$instance_id" \
  --document-name AWS-RunShellScript --comment "deploy $TAG (${GITHUB_SHA:-manual})" \
  --parameters "{\"commands\":$commands,\"executionTimeout\":[\"900\"]}" \
  --query Command.CommandId --output text)"
echo "SSM command $command_id"

status=""
for _ in $(seq 1 180); do
  status="$(aws ssm get-command-invocation --command-id "$command_id" --instance-id "$instance_id" \
    --query Status --output text 2>/dev/null || echo Pending)"
  case "$status" in Success | Failed | Cancelled | TimedOut) break ;; esac
  sleep 5
done
output="$(aws ssm get-command-invocation --command-id "$command_id" --instance-id "$instance_id" \
  --query '[StandardOutputContent,StandardErrorContent]' --output text)"
echo "$output" | grep -E 'voxlivre-boot|rror' || true
[[ "$status" == "Success" ]] || fail "deployment command $status"
grep -q "stack started (image $TAG)" <<<"$output" || fail "the stack did not report image $TAG"

# --- 5. Vérification publique ----------------------------------------------------
for _ in $(seq 1 24); do
  if curl -fsS --max-time 5 "$API_URL/health" >/dev/null; then
    notice "Deployed $TAG — $API_URL/health OK"
    exit 0
  fi
  sleep 5
done
fail "$API_URL/health not OK after deploying $TAG"
