#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -e .git ]]; then
  echo "Skipping submodule ref verification (no git checkout)."
  exit 0
fi

expected="$(git ls-tree HEAD lib/atomic-editor | awk '{print $3}')"
actual="$(tr -d '[:space:]' < lib/atomic-editor.ref)"

if [[ "$expected" != "$actual" ]]; then
  echo "error: lib/atomic-editor.ref (${actual}) does not match git submodule pointer (${expected})" >&2
  echo "Update lib/atomic-editor.ref when bumping the lib/atomic-editor submodule." >&2
  exit 1
fi

echo "Submodule refs match git pointers."
