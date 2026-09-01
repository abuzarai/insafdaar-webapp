#!/usr/bin/env bash
# Insafdaar migration hack — apply backend/migrations/*.sql not yet recorded.
# Bookkeeping: schema_migrations(name, applied_at) in the app db.
# Safe on re-run; new .sql files get picked up automatically on next deploy.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_CONTAINER="${DB_CONTAINER:-insafdaar-db}"
DB_USER="${DB_USER:-postgres}"
DB_NAME="${DB_NAME:-insafdaar_db}"

psql_c() { docker exec -i "$DB_CONTAINER" psql -q -U "$DB_USER" -d "$DB_NAME" "$@"; }

psql_c -c "CREATE TABLE IF NOT EXISTS schema_migrations(
  name text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now());" >/dev/null

applied=0
for f in "$ROOT"/backend/migrations/*.sql; do
  name="$(basename "$f")"
  if [ "$(docker exec "$DB_CONTAINER" psql -t -A -U "$DB_USER" -d "$DB_NAME" \
        -c "SELECT 1 FROM schema_migrations WHERE name='$name';")" = "1" ]; then
    echo "skip  $name (already applied)"
    continue
  fi
  echo "apply $name"
  docker exec -i "$DB_CONTAINER" psql -v ON_ERROR_STOP=1 -q -U "$DB_USER" -d "$DB_NAME" < "$f"
  psql_c -c "INSERT INTO schema_migrations(name) VALUES ('$name');" >/dev/null
  applied=$((applied + 1))
done

echo "migrations: $applied applied, rest skipped"