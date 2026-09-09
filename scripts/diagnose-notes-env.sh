#!/usr/bin/env bash

# Read-only Notes environment diagnostic. This intentionally does not run
# migrations, contract generation, or any other command that writes to the DB.

set -u

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

base_url="${NOTES_BASE_URL:-http://localhost:3000}"
base_url_was_explicit=0
skip_db=0
warning_count=0
failure_count=0

if [[ -n "${NOTES_BASE_URL:-}" ]]; then
  base_url_was_explicit=1
fi

usage() {
  cat <<'EOF'
Usage: pnpm run diagnose:notes -- [options]

Read-only checks for the Notes git checkout, app health, database schema and
migration ledger, GitHub PR checks, and optional Railway CLI linkage.

Options:
  --base-url URL  Check URL/api/health (default: http://localhost:3000)
  --skip-db       Do not connect to DB_NOTES_URL
  --help          Show this help

DB_NOTES_URL is read from the process environment first, then from
apps/notes-next/.env.local or apps/notes-next/.env. Credentials are never
printed. This command never applies migrations.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --)
      shift
      ;;
    --base-url)
      if [[ $# -lt 2 ]]; then
        echo "--base-url requires a URL" >&2
        exit 2
      fi
      base_url="$2"
      base_url_was_explicit=1
      shift 2
      ;;
    --skip-db)
      skip_db=1
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

section() {
  printf '\n%s\n' "$1"
}

pass() {
  printf '  PASS  %s\n' "$1"
}

info() {
  printf '  INFO  %s\n' "$1"
}

warn() {
  warning_count=$((warning_count + 1))
  printf '  WARN  %s\n' "$1"
}

fail() {
  failure_count=$((failure_count + 1))
  printf '  FAIL  %s\n' "$1"
}

read_env_file_value() {
  local env_file="$1"
  local env_key="$2"

  node - "$env_file" "$env_key" <<'NODE'
const fs = require("node:fs")

const [, , filename, key] = process.argv
const text = fs.readFileSync(filename, "utf8")
const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
const assignment = new RegExp(`^\\s*(?:export\\s+)?${escapedKey}\\s*=\\s*(.*)\\s*$`)
let value = ""

for (const line of text.split(/\r?\n/)) {
  const match = line.match(assignment)
  if (!match) continue
  value = match[1].trim()
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1)
  }
}

process.stdout.write(value)
NODE
}

resolve_app_setting() {
  local setting_name="$1"
  local environment_value="${!setting_name:-}"
  local candidate
  local file_value

  if [[ -n "$environment_value" ]]; then
    printf '%s\t%s\n' "$environment_value" "process environment"
    return
  fi

  for candidate in apps/notes-next/.env.local apps/notes-next/.env; do
    if [[ -f "$candidate" ]]; then
      file_value="$(read_env_file_value "$candidate" "$setting_name")"
      if [[ -n "$file_value" ]]; then
        printf '%s\t%s\n' "$file_value" "$candidate"
        return
      fi
    fi
  done

  printf '\t%s\n' "not configured"
}

hash_file() {
  local filename="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$filename" | awk '{print $1}'
  else
    shasum -a 256 "$filename" | awk '{print $1}'
  fi
}

resolve_psql() {
  local candidates=()

  if command -v psql >/dev/null 2>&1; then
    command -v psql
    return
  fi

  shopt -s nullglob
  candidates=(/usr/lib/postgresql/*/bin/psql)
  shopt -u nullglob
  if [[ ${#candidates[@]} -gt 0 ]]; then
    printf '%s\n' "${candidates[@]}" | sort -V | tail -n 1
  fi
}

sanitize_db_error() {
  local message="$1"
  local db_url="$2"
  local db_password=""

  db_password="$(NOTES_DIAG_DB_URL="$db_url" node <<'NODE'
try {
  process.stdout.write(new URL(process.env.NOTES_DIAG_DB_URL).password)
} catch {}
NODE
)"
  message="${message//$db_url/[redacted DB URL]}"
  if [[ -n "$db_password" ]]; then
    message="${message//$db_password/[redacted]}"
  fi
  printf '%s' "$message"
}

printf 'Notes environment diagnostic (read-only)\n'
info "Repository: $repo_root"

section "Git checkout"
if command -v git >/dev/null 2>&1 && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  branch="$(git branch --show-current)"
  revision="$(git rev-parse --short HEAD)"
  dirty="no"
  if [[ -n "$(git status --porcelain)" ]]; then
    dirty="yes"
  fi
  pass "branch=${branch:-detached} revision=$revision dirty=$dirty"
else
  fail "Not inside a git checkout"
fi

if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  pr_summary="$(gh pr view --json number,url,state,headRefName,baseRefName --jq '"PR #\(.number) \(.headRefName) -> \(.baseRefName) [\(.state)] \(.url)"' 2>/dev/null || true)"
  if [[ -n "$pr_summary" ]]; then
    info "$pr_summary"
    while IFS=$'\t' read -r bucket check_name; do
      [[ -z "$check_name" ]] && continue
      info "PR check [$bucket] $check_name"
    done < <(gh pr checks --json name,bucket --jq '.[] | [.bucket,.name] | @tsv' 2>/dev/null || true)
  else
    info "No open GitHub PR found for this branch"
  fi
else
  warn "GitHub CLI is unavailable or not authenticated; PR checks skipped"
fi

section "Application configuration"
db_setting="$(resolve_app_setting DB_NOTES_URL)"
notes_db_url="${db_setting%%$'\t'*}"
db_url_source="${db_setting#*$'\t'}"

if [[ -n "$notes_db_url" ]]; then
  db_description="$(NOTES_DIAG_DB_URL="$notes_db_url" node <<'NODE'
try {
  const url = new URL(process.env.NOTES_DIAG_DB_URL)
  const database = decodeURIComponent(url.pathname.replace(/^\//, "")) || "(default)"
  const socket = url.searchParams.get("host")
  const transport = url.hostname
    ? `${url.hostname}:${url.port || "5432"}`
    : socket
      ? `socket ${socket}`
      : "local socket"
  const sslmode = url.searchParams.get("sslmode")
  process.stdout.write(`${transport}; database=${database}${sslmode ? `; sslmode=${sslmode}` : ""}`)
} catch {
  process.stdout.write("configured, but URL could not be parsed")
}
NODE
)"
  pass "DB_NOTES_URL source=$db_url_source ($db_description; credentials redacted)"
else
  warn "DB_NOTES_URL is not configured in the environment or Notes app env files"
fi

for pool_setting in \
  "PG_POOL_MAX:1" \
  "PG_IDLE_TIMEOUT_MS:0" \
  "PG_CONNECTION_TIMEOUT_MS:10000" \
  "PG_KEEPALIVE_INITIAL_DELAY_MS:10000"; do
  pool_name="${pool_setting%%:*}"
  pool_default="${pool_setting#*:}"
  resolved_pool_setting="$(resolve_app_setting "$pool_name")"
  pool_value="${resolved_pool_setting%%$'\t'*}"
  pool_source="${resolved_pool_setting#*$'\t'}"
  if [[ -z "$pool_value" ]]; then
    pool_value="$pool_default"
    pool_source="code default"
  fi
  info "$pool_name=$pool_value ($pool_source)"
done

section "Application health"
health_file="$(mktemp "${TMPDIR:-/tmp}/notes-health.XXXXXX")"
db_error_file="$(mktemp "${TMPDIR:-/tmp}/notes-db-error.XXXXXX")"
trap 'rm -f "$health_file" "$db_error_file"' EXIT

if command -v curl >/dev/null 2>&1; then
  health_url="${base_url%/}/api/health"
  health_status="$(curl --silent --show-error --max-time 10 --output "$health_file" --write-out '%{http_code}' "$health_url" 2>/dev/null || true)"
  health_body="$(tr '\n' ' ' < "$health_file" | cut -c1-500)"
  if [[ "$health_status" == "200" ]]; then
    pass "$health_url returned HTTP 200"
    info "Response: $health_body"
  elif [[ -z "$health_status" || "$health_status" == "000" ]]; then
    if [[ $base_url_was_explicit -eq 1 ]]; then
      fail "$health_url did not respond"
    else
      warn "$health_url did not respond; start it with pnpm run dev:app"
    fi
  else
    fail "$health_url returned HTTP $health_status"
    [[ -n "$health_body" ]] && info "Response: $health_body"
  fi
else
  warn "curl is unavailable; app health check skipped"
fi

section "Database"
if [[ $skip_db -eq 1 ]]; then
  info "Database checks skipped by --skip-db"
elif [[ -z "$notes_db_url" ]]; then
  warn "Database checks skipped because DB_NOTES_URL is not configured"
else
  psql_bin="$(resolve_psql)"
  if [[ -z "$psql_bin" ]]; then
    warn "psql is unavailable; install a PostgreSQL client to check the target database"
  else
    if server_version="$(PGCONNECT_TIMEOUT=5 "$psql_bin" "$notes_db_url" --no-password -X -qAt -v ON_ERROR_STOP=1 -c "SELECT current_setting('server_version')" 2>"$db_error_file")"; then
      pass "Connected with $($psql_bin --version) to PostgreSQL $server_version"

      relation_query_succeeded=0
      if missing_relations="$(PGCONNECT_TIMEOUT=5 "$psql_bin" "$notes_db_url" --no-password -X -qAt -v ON_ERROR_STOP=1 <<'SQL' 2>"$db_error_file"
WITH required(name) AS (
  VALUES
    ('public.user_v1'),
    ('public.user_api_token_v1'),
    ('public.user_workspace_v1'),
    ('public.user_note_v1'),
    ('public.workspace_note_category_v1'),
    ('public.workspace_note_status_v1'),
    ('public.workspace_note_tag_v1'),
    ('public.user_note_category_link_v1'),
    ('public.user_note_tag_link_v1'),
    ('public.schema_migrations_cursor')
)
SELECT name FROM required WHERE to_regclass(name) IS NULL ORDER BY name;
SQL
)"; then
        relation_query_succeeded=1
        if [[ -z "$missing_relations" ]]; then
          pass "All required Notes relations exist"
        else
          fail "Missing Notes relations: $(printf '%s' "$missing_relations" | tr '\n' ' ')"
        fi
      else
        db_error="$(tr '\n' ' ' < "$db_error_file" | cut -c1-500)"
        db_error="$(sanitize_db_error "$db_error" "$notes_db_url")"
        fail "Required-relation query failed${db_error:+: $db_error}"
      fi

      if [[ $relation_query_succeeded -eq 1 && "$missing_relations" != *"public.schema_migrations_cursor"* ]]; then
        if ! migration_ledger="$(PGCONNECT_TIMEOUT=5 "$psql_bin" "$notes_db_url" --no-password -X -qAt -v ON_ERROR_STOP=1 -F '|' -c "SELECT filename, checksum FROM public.schema_migrations_cursor ORDER BY filename" 2>"$db_error_file")"; then
          db_error="$(tr '\n' ' ' < "$db_error_file" | cut -c1-500)"
          db_error="$(sanitize_db_error "$db_error" "$notes_db_url")"
          fail "Migration-ledger query failed${db_error:+: $db_error}"
          migration_ledger=""
          continue_migration_check=0
        else
          continue_migration_check=1
        fi

        if [[ $continue_migration_check -eq 1 ]]; then
        repo_migration_count="$(find lib/db-notes/migrations -maxdepth 1 -type f -name '*.sql' | wc -l | tr -d ' ')"
        applied_migration_count=0
        if [[ -n "$migration_ledger" ]]; then
          applied_migration_count="$(printf '%s\n' "$migration_ledger" | wc -l | tr -d ' ')"
        fi
        pending_migrations=()
        changed_migrations=()
        extra_migrations=()

        while IFS= read -r migration_path; do
          [[ -z "$migration_path" ]] && continue
          migration_name="$(basename "$migration_path")"
          expected_checksum="$(hash_file "$migration_path")"
          actual_checksum="$(printf '%s\n' "$migration_ledger" | awk -F '|' -v name="$migration_name" '$1 == name { print $2; exit }')"
          if [[ -z "$actual_checksum" ]]; then
            pending_migrations+=("$migration_name")
          elif [[ "$actual_checksum" != "$expected_checksum" ]]; then
            changed_migrations+=("$migration_name")
          fi
        done < <(find lib/db-notes/migrations -maxdepth 1 -type f -name '*.sql' | sort)

        while IFS='|' read -r migration_name _checksum; do
          [[ -z "$migration_name" ]] && continue
          if [[ ! -f "lib/db-notes/migrations/$migration_name" ]]; then
            extra_migrations+=("$migration_name")
          fi
        done <<< "$migration_ledger"

        if [[ ${#pending_migrations[@]} -eq 0 && ${#changed_migrations[@]} -eq 0 && ${#extra_migrations[@]} -eq 0 ]]; then
          pass "Migration ledger matches all $repo_migration_count repository migrations"
        elif [[ ${#pending_migrations[@]} -gt 0 || ${#changed_migrations[@]} -gt 0 ]]; then
          fail "Migration ledger differs (repo=$repo_migration_count applied=$applied_migration_count)"
          [[ ${#pending_migrations[@]} -gt 0 ]] && info "Pending: ${pending_migrations[*]}"
          [[ ${#changed_migrations[@]} -gt 0 ]] && info "Checksum mismatch: ${changed_migrations[*]}"
          [[ ${#extra_migrations[@]} -gt 0 ]] && info "Only in database: ${extra_migrations[*]}"
        else
          warn "All repository migrations are applied, but the database is ahead of this checkout (repo=$repo_migration_count applied=$applied_migration_count)"
          info "Only in database: ${extra_migrations[*]}"
        fi
        fi
      fi
    else
      db_error="$(tr '\n' ' ' < "$db_error_file" | cut -c1-500)"
      db_error="$(sanitize_db_error "$db_error" "$notes_db_url")"
      fail "Database connection failed${db_error:+: $db_error}"
    fi
  fi
fi

section "Railway"
if command -v railway >/dev/null 2>&1; then
  info "Railway CLI: $(railway --version 2>/dev/null | head -n 1)"
  if railway_status="$(railway status 2>&1)"; then
    info "$(printf '%s' "$railway_status" | tr '\n' ' ' | cut -c1-500)"
  else
    warn "Railway CLI is installed but this checkout is not linked or authenticated: $(printf '%s' "$railway_status" | tr '\n' ' ' | cut -c1-300)"
  fi
else
  warn "Railway CLI is not installed; use the PR deployment check or Railway dashboard for deploy logs"
fi

section "Result"
if [[ $failure_count -gt 0 ]]; then
  printf '  %d failure(s), %d warning(s)\n' "$failure_count" "$warning_count"
  exit 1
fi

printf '  No failures; %d warning(s)\n' "$warning_count"
