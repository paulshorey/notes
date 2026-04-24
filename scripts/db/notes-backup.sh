#!/usr/bin/env bash
set -euo pipefail

# Dump DDL only (no data) for selected public tables into a local SQL file.
# Uses MARKETING_DB_URL. Does not dump the whole database — only named tables
# (default: user_v1, user_note_v1, user_note_category_v1, schema_migrations_cursor).
#
# Usage:
#   export MARKETING_DB_URL='postgresql://...'
#   ./scripts/db/notes-backup.sh [OUTFILE.sql]
#   ./scripts/db/notes-backup.sh -t other_table [OUTFILE.sql]
#
# With no OUTFILE, writes to scripts/db/backups/notes-schema-YYYYMMDD-HHMMSS.sql

usage() {
  cat >&2 <<'EOF'
Dump DDL only (no data) for selected public tables. Requires MARKETING_DB_URL.

Usage: notes-backup.sh [-t TABLE]... [OUTFILE.sql]
  -t, --table TABLE   Public table name (repeatable). Default: user_v1, user_note_v1,
                      user_note_category_v1, schema_migrations_cursor
  -h, --help          Show this help.

If OUTFILE is omitted, writes under scripts/db/backups/notes-schema-YYYYMMDD-HHMMSS.sql
EOF
}

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/db/common.sh
source "${script_dir}/common.sh"

tables=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    -h | --help)
      usage
      exit 0
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

outfile=""
if [[ $# -eq 1 ]]; then
  outfile="$1"
elif [[ $# -ne 0 ]]; then
  echo "$0: too many arguments" >&2
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

if [[ -z "$outfile" ]]; then
  repo_root="$(marketing_db_repo_root)"
  backup_dir="${repo_root}/scripts/db/backups"
  mkdir -p "$backup_dir"
  outfile="${backup_dir}/notes-schema-$(date +%Y%m%d-%H%M%S).sql"
fi

marketing_db_require_url
marketing_db_resolve_clients

dump_args=(
  "$MARKETING_DB_URL"
  --schema-only
  --schema=public
  --no-owner
  --no-privileges
)

while IFS= read -r -d '' flag; do
  dump_args+=("$flag")
done < <(marketing_db_pg_dump_table_flags "${tables[@]}")

tmp_err="$(mktemp)"
tmp_sql="$(mktemp)"
cleanup() {
  rm -f "$tmp_err" "$tmp_sql"
}
trap cleanup EXIT

set +e
"${CURSOR_POSTGRES_PG_DUMP}" "${dump_args[@]}" 2>"$tmp_err" \
  | marketing_db_sql_strip_pg_dump_headers \
  >"$tmp_sql"
dump_status=$?
set -e

if [[ "$dump_status" -ne 0 ]]; then
  cat "$tmp_err" >&2
  exit "$dump_status"
fi

mv -f "$tmp_sql" "$outfile"

echo "Wrote schema-only dump for tables: ${tables[*]}" >&2
echo "$outfile"
