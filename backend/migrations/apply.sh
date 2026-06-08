#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MIGRATIONS_DIR="$ROOT_DIR/backend/migrations"

MODE="${1:-docker}"

DB_NAME="${DB_NAME:-insafdaar_db}"
DB_USER="${DB_USER:-postgres}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_CONTAINER="${DB_CONTAINER:-insafdaar-db}"

apply_migrations_docker() {
  for migration in "$MIGRATIONS_DIR"/*.sql; do
    echo "Applying migration (docker): $(basename "$migration")"
    docker exec -i "$DB_CONTAINER" psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" < "$migration"
  done
}

apply_migrations_local() {
  for migration in "$MIGRATIONS_DIR"/*.sql; do
    echo "Applying migration (local): $(basename "$migration")"
    psql \
      -v ON_ERROR_STOP=1 \
      -h "$DB_HOST" \
      -p "$DB_PORT" \
      -U "$DB_USER" \
      -d "$DB_NAME" \
      -f "$migration"
  done
}

case "$MODE" in
  docker)
    apply_migrations_docker
    ;;
  local)
    apply_migrations_local
    ;;
  *)
    echo "Usage: $0 [docker|local]"
    exit 1
    ;;
esac

echo "Done. Applied migrations from $MIGRATIONS_DIR"
