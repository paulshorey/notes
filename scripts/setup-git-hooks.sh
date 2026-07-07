#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -e .git ]]; then
  exit 0
fi

current_hooks_path="$(git config --get core.hooksPath || true)"
if [[ "$current_hooks_path" != ".husky" ]]; then
  git config core.hooksPath .husky
  echo "Configured git hooks path: .husky"
fi
