#!/usr/bin/env bash
set -euo pipefail

# Print the commit hash for a git submodule path.
# Resolution order:
# 1. git ls-tree (local/CI checkout with .git)
# 2. GitHub API via RAILWAY_GIT_* vars (Railway build without .git)
# 3. committed <path>.ref fallback

path="${1:?submodule path required}"

if [[ -e .git ]]; then
  git ls-tree HEAD "$path" | awk '{print $3}'
  exit 0
fi

if [[ -n "${RAILWAY_GIT_COMMIT_SHA:-}" ]]; then
  owner="${RAILWAY_GIT_REPO_OWNER:-paulshorey}"
  repo="${RAILWAY_GIT_REPO_NAME:-notes}"
  api_url="https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${RAILWAY_GIT_COMMIT_SHA}"

  commit="$(
    python3 - "$api_url" <<'PY'
import json
import sys
import urllib.request

url = sys.argv[1]
with urllib.request.urlopen(url) as response:
    payload = json.load(response)

sha = payload.get("sha")
if not sha:
    raise SystemExit(f"GitHub API response for {url} did not include a submodule sha")

print(sha)
PY
  )"
  echo "$commit"
  exit 0
fi

ref_file="${path}.ref"
if [[ -f "$ref_file" ]]; then
  tr -d '[:space:]' < "$ref_file"
  exit 0
fi

echo "error: cannot resolve submodule commit for ${path}" >&2
exit 1
