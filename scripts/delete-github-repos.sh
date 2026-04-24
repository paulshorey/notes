#!/usr/bin/env bash
# Delete a fixed list of GitHub repositories owned by you (or GITHUB_OWNER).
#
# Prerequisites:
#   - GitHub CLI: https://cli.github.com/
#   - Logged in: gh auth login
#   - delete_repo scope: gh auth refresh -s delete_repo
#
# Usage:
#   ./scripts/delete-github-repos.sh              # delete for each name below
#   DRY_RUN=1 ./scripts/delete-github-repos.sh    # print commands only
#   GITHUB_OWNER=other-org ./scripts/delete-github-repos.sh
#
# WARNING: Permanent data loss. Review REPOS and owner before running.
#
# Missing repositories: skipped with a message (no error exit). Other failures
# during delete print a warning and the script continues.

set -euo pipefail

REPOS=(
news-writer
hb
fly
suser
fn
n15
stytch-auth
secrets
fa-docs
aw1
cfe
fa-fe
counter
trade
log
save
auth
supabase-nextjs-user-management
supa
firebase-auth
fa-docrepo
payloadcms
demo-stytch-auth
demo-notes-app
archive-web1
archive-mono
archive-mono-cms-ps
turbo
stitches-site
react-prism-editor
Schaff-Trend-Cycle
twodashes-browser
twodashes-universal
twodashes-node
mold
firebase
map-sandbox
sanity-blog
psnext
nlp-be-terraform
notes
documents
wordio
domains-api
domain-names
)

if ! command -v gh >/dev/null 2>&1; then
  echo "error: gh (GitHub CLI) is not on PATH. Install: https://cli.github.com/" >&2
  exit 1
fi

owner="${GITHUB_OWNER:-}"
if [[ -z "$owner" ]]; then
  owner="$(gh api user -q .login)"
fi

if [[ -z "$owner" ]]; then
  echo "error: could not resolve GitHub login. Set GITHUB_OWNER or run: gh auth login" >&2
  exit 1
fi

echo "Owner: ${owner}"
echo "Repositories to delete: ${#REPOS[@]}"
echo ""

for name in "${REPOS[@]}"; do
  full="${owner}/${name}"
  if [[ -n "${DRY_RUN:-}" ]]; then
    echo "DRY_RUN: would run: gh repo delete ${full} --yes"
    continue
  fi
  if ! gh api "repos/${owner}/${name}" --silent 2>/dev/null; then
    echo "Skipping ${full}: repository does not exist"
    continue
  fi
  echo "Deleting ${full} ..."
  if ! gh repo delete "${full}" --yes; then
    echo "Warning: failed to delete ${full}; continuing." >&2
  fi
done

echo "Done."
