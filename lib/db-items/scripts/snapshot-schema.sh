#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
package_dir="$(cd "${script_dir}/.." && pwd)"
repo_root="$(cd "${package_dir}/../.." && pwd)"

export DB_ITEMS_URL="${DB_ITEMS_URL:-${DB_NOTES_URL:-}}"
if [[ -z "${DB_ITEMS_URL:-}" ]]; then
  echo "DB_ITEMS_URL is required (DB_NOTES_URL is accepted for existing deployments)"
  exit 1
fi

eval "$(
  bash "${repo_root}/scripts/check-postgres-client-version.sh" \
    DB_ITEMS_URL \
    "@lib/db-items" \
    --print-env
)"

"${CURSOR_POSTGRES_PG_DUMP}" "$DB_ITEMS_URL" \
  --schema-only \
  --schema=public \
  --no-owner \
  --no-privileges \
  --exclude-table=public.schema_migrations_cursor \
  | sed \
      -e '/^-- Dumped from database version /d' \
      -e '/^-- Dumped by pg_dump version /d' \
      -e '/^\\restrict /d' \
      -e '/^\\unrestrict /d' \
      -e '/^CREATE SCHEMA public;$/d' \
      -e "/^COMMENT ON SCHEMA public IS 'standard public schema';$/d" \
  | perl -0777 -pe 's/\n+\z/\n/' \
  > "${package_dir}/schema/current.sql"

echo "Wrote schema/current.sql"
