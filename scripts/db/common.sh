#!/usr/bin/env bash
# Shared helpers for scripts/db/*.sh (source this file; do not execute directly).

items_db_repo_root() {
  local here
  # This file lives at scripts/db/common.sh
  here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  cd "${here}/../.." && pwd
}

items_db_require_url() {
  export DB_ITEMS_URL="${DB_ITEMS_URL:-${DB_NOTES_URL:-}}"
  if [[ -z "${DB_ITEMS_URL:-}" ]]; then
    echo "DB_ITEMS_URL must be set in the environment (postgresql://...)" >&2
    exit 1
  fi
}

# Sets CURSOR_POSTGRES_PSQL and CURSOR_POSTGRES_PG_DUMP (and related) from
# scripts/check-postgres-client-version.sh — same as lib/db-items snapshot.
items_db_resolve_clients() {
  local repo_root
  repo_root="$(items_db_repo_root)"
  eval "$(
    bash "${repo_root}/scripts/check-postgres-client-version.sh" \
      DB_ITEMS_URL \
      "@lib/db-items" \
      --print-env
  )"
}

# Default Notes app tables for local schema backup/reset (does not touch other tables).
# Keep in sync with lib/db-items/scripts/verify-contract.mjs expected tables.
readonly ITEMS_DB_DEFAULT_TABLES=(
  user_v1
  user_api_token_v1
  user_workspace_v1
  workspace_item_v1
  workspace_category_v1
  workspace_status_v1
  workspace_tag_v1
  item_category_link_v1
  item_tag_link_v1
  schema_migrations_cursor
)

# pg_dump -t public.NAME for each table
items_db_pg_dump_table_flags() {
  local t
  for t in "$@"; do
    printf '%s\0' "-t"
    printf '%s\0' "public.${t}"
  done
}

# Filter pg_dump plain-SQL so restoring onto a DB that already has
# apply_row_timestamps_v1() does not fail on CREATE FUNCTION.
items_db_sql_apply_row_timestamps_or_replace() {
  # Match the first line of CREATE FUNCTION ... apply_row_timestamps_v1()
  perl -pe 's/^CREATE FUNCTION public\.apply_row_timestamps_v1\(\)/CREATE OR REPLACE FUNCTION public.apply_row_timestamps_v1()/'
}

# Strip noisy header lines (matches lib/db-items/scripts/snapshot-schema.sh)
items_db_sql_strip_pg_dump_headers() {
  sed \
    -e '/^-- Dumped from database version /d' \
    -e '/^-- Dumped by pg_dump version /d' \
    -e '/^\\restrict /d' \
    -e '/^\\unrestrict /d'
}
