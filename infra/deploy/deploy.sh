#!/usr/bin/env bash
# Manual production deploy, run on the app server. Idempotent.
#
#   HEALTH_URL=https://api.example.com/health ./infra/deploy/deploy.sh
#
# Pulls, rebuilds the api image, restarts the stack and waits for /health.
# Migrations run when the api container boots (apps/api/Dockerfile CMD).
set -euo pipefail

HEALTH_URL="${HEALTH_URL:-https://api.example.com/health}"

cd "$(dirname "$0")/../.."

echo "==> git pull"
git pull --ff-only

cd infra/deploy

echo "==> docker compose build"
docker compose build

echo "==> docker compose up -d"
docker compose up -d

echo "==> waiting for health at ${HEALTH_URL}"
for _ in $(seq 1 30); do
  if curl -fsS "${HEALTH_URL}" >/dev/null 2>&1; then
    echo "healthy"
    exit 0
  fi
  sleep 3
done

echo "health check failed after 90s — recent api logs:"
docker compose logs --tail=50 api
exit 1
