#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -e .git ]]; then
  echo "Skipping submodule ref verification (no git checkout)."
  exit 0
fi

bash scripts/sync-submodule-refs.sh

if ! git diff --quiet -- lib/*.ref; then
  echo "error: submodule ref pins were out of date and have been refreshed in the working tree" >&2
  echo "Stage the updated *.ref files and commit them (pre-commit should do this automatically)." >&2
  git diff -- lib/*.ref >&2 || true
  exit 1
fi

echo "Submodule refs match git pointers."
