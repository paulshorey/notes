#!/usr/bin/env bash
# Bootstrap a Cursor cloud workspace: pnpm deps, app toolchains, PostgreSQL.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# Ensure node/corepack are on PATH (NVM installs under /home/ubuntu on the
# Cursor cloud image but the agent runs as root).
if ! command -v node >/dev/null 2>&1; then
  for candidate in /home/ubuntu/.nvm/versions/node/*/bin; do
    if [[ -x "$candidate/node" ]]; then
      export PATH="$candidate:$PATH"
      break
    fi
  done
fi

export CI="${CI:-true}"
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
export HUSKY="${HUSKY:-0}"
export PNPM_HOME="${PNPM_HOME:-$HOME/.local/share/pnpm}"

mkdir -p "$ROOT_DIR/.turbo" "$PNPM_HOME"

case ":$PATH:" in
  *":$PNPM_HOME:"*) ;;
  *) export PATH="$PNPM_HOME:$PATH" ;;
esac

# 1. Install workspace dependencies (corepack, pnpm fetch + install)
bash scripts/install-workspace-deps.sh "$@"

# 2. Provision app-specific toolchains
bash apps/notes-android/tools/cloud-provision.sh

# 3. Install PostgreSQL 17 client tools (psql, pg_dump) for db:migrate and db:verify
PG17_BINDIR="/usr/lib/postgresql/17/bin"

has_pg17_clients() {
  if [[ -x "${PG17_BINDIR}/psql" && -x "${PG17_BINDIR}/pg_dump" ]]; then
    return 0
  fi

  if ! command -v psql >/dev/null 2>&1 || ! command -v pg_dump >/dev/null 2>&1; then
    return 1
  fi

  psql --version | grep -qE '\b17(\.|[[:space:]])' \
    && pg_dump --version | grep -qE '\b17(\.|[[:space:]])'
}

if ! has_pg17_clients; then
  echo "Installing PostgreSQL 17 client tools..."
  sudo apt-get update -qq
  sudo apt-get install -y postgresql-common ca-certificates
  sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y
  sudo apt-get install -y postgresql-client-17
fi

if [[ -x "${PG17_BINDIR}/pg_dump" ]]; then
  echo "PostgreSQL client tools ready: $("${PG17_BINDIR}/pg_dump" --version)"
elif command -v pg_dump >/dev/null 2>&1; then
  echo "PostgreSQL client tools ready: $(pg_dump --version)"
fi
