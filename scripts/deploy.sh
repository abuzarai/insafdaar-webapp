#!/usr/bin/env bash
# Insafdaar deploy.sh — pull all 4 repos, apply pending migrations, refresh the stack.
# Runs on the Oracle VM as `ubuntu`, invoked by GitHub Actions (deploy.yml).
# Layout expected: ~/insafdaar/{webapp,legal-rag-assistant,drafting-assistant,voice-intake-agent}
set -euo pipefail

BASE="${DEPLOY_BASE:-$HOME/insafdaar}"
REPOS=(webapp legal-rag-assistant drafting-assistant voice_intake_agent)

echo "[deploy] $(date -Is)"

if [ ! -d "$BASE/webapp/.git" ]; then
  echo "[deploy] ~/insafdaar not set up on this box yet."
  echo "[deploy] Clone the four repos into ~/insafdaar first, then re-run."
  exit 1
fi

for r in "${REPOS[@]}"; do
  echo "==> pull $r"
  git -C "$BASE/$r" fetch --quiet origin
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

echo "==> build + up"
docker compose up -d --build --remove-orphans

echo "==> health (containers, via compose healthchecks)"
ok=1
for i in $(seq 1 12); do
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