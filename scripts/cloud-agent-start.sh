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

# Start the local PostgreSQL 17 cluster and provision throwaway Notes DBs.
# This is per-boot: environment-build snapshots keep packages, not processes.
bash "$ROOT_DIR/scripts/cloud-agent-postgres.sh" start

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
    if ! pnpm run init; then
      echo "Infisical hydration failed. Local PostgreSQL is still available:"
      echo "  export DB_NOTES_URL='postgres:///notes?host=/var/run/postgresql'"
      echo "  export DB_NOTES_TEST_URL='postgres:///notes_test?host=/var/run/postgresql'"
    fi
  else
    echo "App .env files are missing, but Infisical bootstrap secrets are not configured."
    echo "Set INFISICAL_TOKEN and INFISICAL_PROJECT_ID in Cursor Cloud Agent secrets, then rerun pnpm run init."
    echo "Local PostgreSQL is available without Infisical:"
    echo "  export DB_NOTES_URL='postgres:///notes?host=/var/run/postgresql'"
    echo "  export DB_NOTES_TEST_URL='postgres:///notes_test?host=/var/run/postgresql'"
  fi
fi

echo "Workspace ready."
echo "Recommended commands:"
echo "  export PATH=\"/usr/lib/postgresql/17/bin:\$PATH\""
echo "  export DB_NOTES_URL='postgres:///notes?host=/var/run/postgresql'"
echo "  export DB_NOTES_TEST_URL='postgres:///notes_test?host=/var/run/postgresql'"
echo "  pnpm run db:migrate"
echo "  pnpm --filter notes-next dev"
echo "  pnpm --filter notes-android build"
