#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# Ensure node/pnpm are on PATH (NVM installs under /home/ubuntu on the
# Cursor cloud image but the agent runs as root).
if ! command -v node >/dev/null 2>&1; then
  for candidate in /home/ubuntu/.nvm/versions/node/*/bin; do
    if [[ -x "$candidate/node" ]]; then
      export PATH="$candidate:$PATH"
      break
    fi
  done
fi

export PNPM_HOME="${PNPM_HOME:-$HOME/.local/share/pnpm}"
case ":$PATH:" in
  *":$PNPM_HOME:"*) ;;
  *) export PATH="$PNPM_HOME:$PATH" ;;
esac

pg17_bindir="/usr/lib/postgresql/17/bin"
if [[ -d "$pg17_bindir" ]]; then
  case ":$PATH:" in
    *":$pg17_bindir:"*) ;;
    *) export PATH="$pg17_bindir:$PATH" ;;
  esac
fi

# Provision a local Postgres for notes-next dev and @lib/db-marketing tests.
# The injected MARKETING_DB_URL points at a remote Railway DB, so local work
# (db:migrate and tests via DB_MARKETING_TEST_URL) must run against this local
# cluster. Idempotent: safe to re-run on every boot. postgresql-17 +
# postgresql-17-pgvector are installed by scripts/cloud-agent-install.sh.
if [[ -x "$pg17_bindir/postgres" ]]; then
  if ! pg_lsclusters -h 2>/dev/null | awk '{print $1"/"$2}' | grep -qx "17/main"; then
    sudo pg_createcluster 17 main >/dev/null 2>&1 || true
  fi
  cluster_status="$(pg_lsclusters -h 2>/dev/null | awk '$1=="17" && $2=="main" {print $4}')"
  if [[ "$cluster_status" != "online" ]]; then
    sudo pg_ctlcluster 17 main start >/dev/null 2>&1 || true
  fi
  if sudo -u postgres psql -tAc "SELECT 1" >/dev/null 2>&1; then
    sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='notes'" | grep -q 1 \
      || sudo -u postgres psql -c "CREATE ROLE notes LOGIN PASSWORD 'notes' SUPERUSER;" >/dev/null 2>&1 || true
    for db in notes notes_test; do
      sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='$db'" | grep -q 1 \
        || sudo -u postgres createdb -O notes "$db" >/dev/null 2>&1 || true
    done
    echo "Local Postgres ready on localhost:5432 (databases: notes, notes_test)."
  fi
fi

expected_env_files=(
  "apps/notes-next/.env"
)

missing_env=0
for env_file in "${expected_env_files[@]}"; do
  if [[ ! -f "$env_file" ]]; then
    missing_env=1
    break
  fi
done

if [[ $missing_env -eq 1 ]]; then
  if [[ -n "${INFISICAL_TOKEN:-}" && -n "${INFISICAL_PROJECT_ID:-}" ]]; then
    echo "Hydrating app .env files from Infisical..."
    pnpm run init
  else
    echo "App .env files are missing, but Infisical bootstrap secrets are not configured."
    echo "Set INFISICAL_TOKEN and INFISICAL_PROJECT_ID in Cursor Cloud Agent secrets, then rerun pnpm run init."
  fi
fi

echo "Workspace ready."
echo "Recommended commands:"
echo "  pnpm run deps:install -- <package>..."
echo "  pnpm --filter notes-next dev"
echo "  pnpm --filter notes-android build"
