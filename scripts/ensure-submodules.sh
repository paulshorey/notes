#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

submodule_url() {
  local name="$1"
  git config -f .gitmodules --get "submodule.${name}.url"
}

submodule_path() {
  local name="$1"
  git config -f .gitmodules --get "submodule.${name}.path"
}

submodule_populated() {
  local path="$1"
  [[ -f "${path}/package.json" ]]
}

clone_submodule_at_commit() {
  local path="$1"
  local url="$2"
  local commit="$3"

  if [[ -z "$commit" ]]; then
    echo "error: missing commit for ${path}" >&2
    exit 1
  fi

  echo "Cloning ${path} at ${commit}"
  rm -rf "$path"
  git clone --filter=blob:none --no-checkout "$url" "$path"
  git -C "$path" checkout "$commit"
}

if [[ ! -f .gitmodules ]]; then
  exit 0
fi

if submodule_populated "lib/atomic-editor"; then
  exit 0
fi

atomic_editor_path="$(submodule_path "lib/atomic-editor")"
atomic_editor_url="$(submodule_url "lib/atomic-editor")"

if [[ -e .git ]]; then
  git submodule update --init --recursive
  bash scripts/sync-submodule-refs.sh
  exit 0
fi

commit="$(bash scripts/resolve-submodule-commit.sh "$atomic_editor_path")"
clone_submodule_at_commit "$atomic_editor_path" "$atomic_editor_url" "$commit"
