#!/usr/bin/env bash
set -euo pipefail

missing=()

require_command() {
  local command_name="$1"
  if ! command -v "$command_name" >/dev/null 2>&1; then
    missing+=("$command_name")
  fi
}

require_command "java"
require_command "python3"
require_command "curl"
require_command "unzip"
require_command "yes"

if ((${#missing[@]} > 0)); then
  echo "Android builds require the following commands: ${missing[*]}" >&2
  if [[ " ${missing[*]} " == *" java "* ]]; then
    echo "Java is required for Android builds. In Cursor cloud workspaces, run \`pnpm run cloud:install\` to provision the repo-local JDK once per persisted workspace." >&2
  fi
  echo "Install the missing prerequisites, then rerun the build." >&2
  exit 1
fi
