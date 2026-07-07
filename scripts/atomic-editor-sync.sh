#!/usr/bin/env bash
set -euo pipefail

# Sync lib/atomic-editor between this monorepo and the standalone fork
# (paulshorey/atomic-editor) using git subtree.
#
# Usage:
#   scripts/atomic-editor-sync.sh push [<fork-branch>]   # monorepo -> fork
#   scripts/atomic-editor-sync.sh pull [<fork-branch>]   # fork -> monorepo
#
# Environment overrides:
#   ATOMIC_EDITOR_FORK_URL   fork git URL (default: paulshorey/atomic-editor)
#
# Notes:
# - The prefix lib/atomic-editor was imported with `git subtree add` (no
#   --squash), so the fork's history is a real ancestor here. Keep using
#   non-squash push/pull so history stays linked and diffs stay minimal.
# - Pushing creates/updates a branch on the fork; open the PR from there.

PREFIX="lib/atomic-editor"
FORK_URL="${ATOMIC_EDITOR_FORK_URL:-https://github.com/paulshorey/atomic-editor.git}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

cmd="${1:-}"
branch="${2:-}"

case "$cmd" in
  push)
    branch="${branch:-}"
    if [[ -z "$branch" ]]; then
      echo "usage: $0 push <fork-branch>" >&2
      echo "  (choose a NEW branch name on the fork, then open a PR from it)" >&2
      exit 1
    fi
    echo "Pushing ${PREFIX} -> ${FORK_URL} (branch: ${branch})"
    git subtree push --prefix="$PREFIX" "$FORK_URL" "$branch"
    ;;
  pull)
    branch="${branch:-main}"
    echo "Pulling ${FORK_URL} (branch: ${branch}) -> ${PREFIX}"
    git subtree pull --prefix="$PREFIX" "$FORK_URL" "$branch"
    ;;
  *)
    echo "usage: $0 {push|pull} [<fork-branch>]" >&2
    exit 1
    ;;
esac
