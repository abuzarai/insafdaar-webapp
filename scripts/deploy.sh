#!/usr/bin/env bash
# Insafdaar deploy.sh — pull all 4 repos, apply pending migrations, refresh the stack.
# Runs on the Oracle VM as `ubuntu`, invoked by GitHub Actions (deploy.yml).
# Layout expected: ~/insafdaar/{webapp,legal-rag-assistant,drafting-assistant,voice-intake-agent}
set -euo pipefail

BASE="${DEPLOY_BASE:-$HOME/insafdaar}"
REPOS=(webapp legal-rag-assistant drafting-assistant voice_intake_agent)

echo "[deploy] $(date -Is)"

# Serialize deploys: multiple repos push simultaneously (one pipeline per
# repo), and concurrent git/compose operations on the same clones collide.
exec 9>/tmp/insafdaar-deploy.lock
if ! flock -w 3600 9; then
  echo "[deploy] another deploy holds the lock; giving up after 60m wait."
  exit 1
fi

if [ ! -d "$BASE/webapp/.git" ]; then
  echo "[deploy] ~/insafdaar not set up on this box yet."
  echo "[deploy] Clone the four repos into ~/insafdaar first, then re-run."
  exit 1
fi

for r in "${REPOS[@]}"; do
  echo "==> pull $r"
  # retry transient ref-lock contention (concurrent fetch with a manual pull)
  for i in 1 2 3; do
    if git -C "$BASE/$r" fetch --quiet origin; then break; fi
    [ "$i" -lt 3 ] && sleep 5
  done
  git -C "$BASE/$r" checkout -q -f main
  git -C "$BASE/$r" reset --hard --quiet origin/main
done

cd "$BASE/webapp"

echo "==> db up + wait"
docker compose up -d db
for i in $(seq 1 30); do
  docker exec insafdaar-db pg_isready -U postgres -d insafdaar_db -q && break
  sleep 2
done

echo "==> migrations"
bash scripts/apply-migrations.sh

echo "==> verify images present"
for img in webapp-backend:latest webapp-frontend:latest webapp-legal-rag:latest webapp-drafting:latest webapp-voice:latest; do
  if ! docker image inspect "$img" >/dev/null 2>&1; then
    echo "[deploy] MISSING IMAGE: $img — the build pipeline must ship it first."
    exit 1
  fi
done

echo "==> up (images shipped prebuilt; no build on this host)"
docker compose up -d --remove-orphans

echo "==> health (containers, via compose healthchecks)"
ok=1
# grace up to ~150s: on the 1GB micro a container can be restarting or
# still within its start window right after a big build
for i in $(seq 1 30); do
  ready=1
  for c in db backend frontend weaviate legal-rag drafting voice; do
    st=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "insafdaar-$c" 2>/dev/null || echo missing)
    [ "$st" = "healthy" ] || ready=0
  done
  [ "$ready" = "1" ] && break
  sleep 5
done
for c in db backend frontend weaviate legal-rag drafting voice; do
  st=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "insafdaar-$c" 2>/dev/null || echo missing)
  echo "    $st  $c"
  [ "$st" = "healthy" ] || ok=0
done

echo "[deploy] done $(date -Is) (ok=$ok)"
exit "$((1-ok))"