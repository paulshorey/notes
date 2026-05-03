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
