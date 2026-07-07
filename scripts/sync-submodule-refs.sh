#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -e .git ]] || [[ ! -f .gitmodules ]]; then
  echo "Skipping submodule ref sync (no git checkout or .gitmodules)."
  exit 0
fi

while IFS= read -r path; do
  if ! entry="$(git ls-tree HEAD "$path" 2>/dev/null)"; then
    echo "warning: submodule path ${path} is not present in HEAD; skipping" >&2
    continue
  fi

  commit="$(awk '{print $3}' <<<"$entry")"
  printf '%s\n' "$commit" > "${path}.ref"
  echo "Synced ${path}.ref -> ${commit}"
done < <(git config -f .gitmodules --get-regexp '^submodule\..*\.path$' | awk '{print $2}')
