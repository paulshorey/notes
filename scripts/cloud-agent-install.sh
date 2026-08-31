#!/usr/bin/env bash
# Bootstrap a Cursor cloud workspace: PostgreSQL 17 + pgvector, pnpm deps, app toolchains.
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

# 1. PostgreSQL 17 server, client tools (psql, pg_dump), and pgvector.
#    The postmaster is started later by cloud-agent-start.sh.
bash scripts/cloud-agent-postgres.sh install

# 2. Install workspace dependencies (corepack, pnpm fetch + install)
bash scripts/install-workspace-deps.sh "$@"

# 3. Provision app-specific toolchains
bash apps/notes-android/tools/cloud-provision.sh
