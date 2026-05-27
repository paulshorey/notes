#!/usr/bin/env bash
set -euo pipefail

# Truncate the specified public tables (default: marketing Notes subset), then
# load row data from a data-only SQL file produced by notes-backup-data.sh.
# Uses MARKETING_DB_URL. Only named tables are truncated; other tables are untouched.
# Run notes-restore-schema.sh first so tables exist with the expected schema.
#
# Usage:
#   export MARKETING_DB_URL='postgresql://...'
#   ./scripts/db/notes-restore-data.sh ./scripts/db/backups/notes-data-....sql
#   ./scripts/db/notes-restore-data.sh -y BACKUP.sql    # skip confirmation
#
# Tables to truncate must match the backup; use the same -t list as for notes-backup-data.sh.

usage() {
  cat >&2 <<'EOF'
Truncate named public tables, then load row data from a data-only backup. Requires MARKETING_DB_URL.

Usage: notes-restore-data.sh [-y] [-t TABLE]... BACKUP.sql
  -t, --table TABLE   Public tables to truncate before restore (repeatable). Default: same
                      tables as notes-backup-data.sh (MARKETING_DB_DEFAULT_TABLES in common.sh)
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
  echo "This will TRUNCATE these tables then load data from:" >&2
  echo "  $backup_file" >&2
  echo "Tables: ${tables[*]}" >&2
  echo "Database: (from MARKETING_DB_URL)" >&2
  read -r -p "Type YES to continue: " confirm
  if [[ "$confirm" != "YES" ]]; then
    echo "Aborted." >&2
    exit 1
  fi
fi

truncate_sql="$(mktemp)"
trap 'rm -f "$truncate_sql"' EXIT

{
  printf '%s\n' "SET client_min_messages = WARNING;"
  printf 'TRUNCATE TABLE '
  comma=0
  for t in "${tables[@]}"; do
    if [[ "$comma" -eq 1 ]]; then
      printf ', '
    fi
    comma=1
    printf 'public.%s' "$t"
  done
  printf ' RESTART IDENTITY CASCADE;\n'
} >"$truncate_sql"

# shellcheck disable=SC2094
{
  cat "$truncate_sql"
  cat "$backup_file"
} | "${CURSOR_POSTGRES_PSQL}" "$MARKETING_DB_URL" -v ON_ERROR_STOP=1 -f -

echo "Data restore complete for tables: ${tables[*]}" >&2
