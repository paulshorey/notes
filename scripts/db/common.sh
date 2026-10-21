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

# Default item-service tables for local schema backup/reset.
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
    printf '%s\0' "public.\"${t}\""
  done
}

# Known dependent views are part of an item table's schema backup. They contain
# no separate rows and must be dropped/recreated alongside that table.
items_db_compatibility_view() {
  case "$1" in
    workspace_item_v1) printf '%s' user_note_v1 ;;
    workspace_category_v1) printf '%s' workspace_note_category_v1 ;;
    workspace_status_v1) printf '%s' workspace_note_status_v1 ;;
    workspace_tag_v1) printf '%s' workspace_note_tag_v1 ;;
    item_category_link_v1) printf '%s' user_note_category_link_v1 ;;
    item_tag_link_v1) printf '%s' user_note_tag_link_v1 ;;
  esac
}

# pg_dump --table deliberately omits dependencies outside selected relations.
# Include the item schema's extension and trigger function when selected tables
# actually use them, so the dump also restores into an empty database.
# Callers validate every table name before constructing this SQL list.
items_db_schema_dependencies() {
  local table table_list="" separator=""
  for table in "$@"; do
    table_list+="${separator}'${table}'"
    separator=","
  done
  "${CURSOR_POSTGRES_PSQL}" "$DB_ITEMS_URL" -X -A -t -v ON_ERROR_STOP=1 <<SQL
SELECT 'CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;'
WHERE EXISTS (
  SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
  JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relname IN (${table_list})
    AND NOT a.attisdropped AND a.atttypid=to_regtype('public.vector')
);
SELECT pg_get_functiondef(p.oid) FROM pg_proc p
WHERE p.oid=to_regprocedure('public.apply_row_timestamps_v1()') AND EXISTS (
  SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
  JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE t.tgfoid=p.oid AND n.nspname='public' AND c.relname IN (${table_list})
);
SQL
}

# These tools restore their own plain pg_dump files. Reject empty, wrong-kind,
# old-schema, or partial files before dropping/truncating the selected tables.
items_db_require_dump_tables() {
  local kind="$1" file="$2" table operation
  shift 2
  if [[ "$kind" == "schema" ]]; then
    operation="CREATE TABLE"
  else
    operation="COPY"
  fi
  for table in "$@"; do
    if ! LC_ALL=C grep -Eq "^${operation} public\\.(\"${table}\"|${table})[[:space:]]*\\(" "$file"; then
      echo "Invalid ${kind} backup: missing public.${table}; use the matching dump and the same table list." >&2
      return 1
    fi
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
