#!/usr/bin/env bash
set -euo pipefail

# Drop the specified public tables (default: marketing Notes subset), then
# recreate them from a schema-only SQL file produced by notes-backup.sh.
# Uses MARKETING_DB_URL. Only named tables are dropped; other tables are untouched.
# CASCADE also removes dependent objects on those tables (e.g. views referencing them).
# Shared trigger function apply_row_timestamps_v1 is replaced via CREATE OR REPLACE when present in the dump.
#
# Usage:
#   export MARKETING_DB_URL='postgresql://...'
#   ./scripts/db/notes-restore.sh ./scripts/db/backups/notes-schema-....sql
#   ./scripts/db/notes-restore.sh -y BACKUP.sql    # skip confirmation
#
# Tables to drop must match the backup; use the same -t list as for notes-backup.sh.

usage() {
  cat >&2 <<'EOF'
Drop named public tables, then recreate them from a schema-only backup. Requires MARKETING_DB_URL.

Usage: notes-restore.sh [-y] [-t TABLE]... BACKUP.sql
  -t, --table TABLE   Public tables to drop before restore (repeatable). Default: same
                      four tables as notes-backup.sh
  -y, --yes           Do not prompt for confirmation
  -h, --help          Show this help
EOF
}

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/db/common.sh
source "${script_dir}/common.sh"

assume_yes=0
tables=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    -h | --help)
      usage
      exit 0
      ;;
    -y | --yes)
      assume_yes=1
      shift
      ;;
    -t | --table)
      if [[ $# -lt 2 ]]; then
        echo "$0: --table requires a value" >&2
        exit 1
      fi
      tables+=("$2")
      shift 2
      ;;
    -*)
      echo "$0: unknown option: $1" >&2
      exit 1
      ;;
    *)
      break
      ;;
  esac
done

if [[ $# -ne 1 ]]; then
  echo "$0: expected exactly one backup file argument" >&2
  exit 1
fi

backup_file="$1"
if [[ ! -f "$backup_file" ]]; then
  echo "$0: file not found: $backup_file" >&2
  exit 1
fi

if [[ ${#tables[@]} -eq 0 ]]; then
  tables=("${MARKETING_DB_DEFAULT_TABLES[@]}")
fi

for _t in "${tables[@]}"; do
  if [[ ! "$_t" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]]; then
    echo "$0: invalid table name: $_t" >&2
    exit 1
  fi
done

marketing_db_require_url
marketing_db_resolve_clients

if [[ "$assume_yes" -ne 1 ]]; then
  if [[ ! -t 0 ]]; then
    echo "$0: stdin is not a terminal; use -y to confirm non-interactively" >&2
    exit 1
  fi
  echo "This will DROP these tables (and dependent objects on them) then restore from:" >&2
  echo "  $backup_file" >&2
  echo "Tables: ${tables[*]}" >&2
  echo "Database: (from MARKETING_DB_URL)" >&2
  read -r -p "Type YES to continue: " confirm
  if [[ "$confirm" != "YES" ]]; then
    echo "Aborted." >&2
    exit 1
  fi
fi

drop_sql="$(mktemp)"
trap 'rm -f "$drop_sql"' EXIT

{
  printf '%s\n' "SET client_min_messages = WARNING;"
  printf 'DROP TABLE IF EXISTS '
  comma=0
  for t in "${tables[@]}"; do
    if [[ "$comma" -eq 1 ]]; then
      printf ', '
    fi
    comma=1
    printf 'public.%s' "$t"
  done
  printf ' CASCADE;\n'
} >"$drop_sql"

# shellcheck disable=SC2094
{
  cat "$drop_sql"
  marketing_db_sql_apply_row_timestamps_or_replace <"$backup_file"
} | "${CURSOR_POSTGRES_PSQL}" "$MARKETING_DB_URL" -v ON_ERROR_STOP=1 -f -

echo "Restore complete for tables: ${tables[*]}" >&2
