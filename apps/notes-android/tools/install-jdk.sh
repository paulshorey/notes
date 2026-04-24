#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
JDK_ROOT="${REPO_JAVA_HOME:-$REPO_ROOT/.jdk/current}"
JDK_PARENT="$(dirname "$JDK_ROOT")"

require_command() {
  local command_name="$1"
  local install_hint="$2"

  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Missing required command '$command_name'. $install_hint" >&2
    exit 1
  fi
}

detect_jdk_os() {
  case "$(uname -s)" in
    Linux) echo "linux" ;;
    Darwin) echo "mac" ;;
    *)
      echo "Unsupported host OS for JDK install: $(uname -s)" >&2
      exit 1
      ;;
  esac
}

detect_jdk_arch() {
  case "$(uname -m)" in
    x86_64|amd64) echo "x64" ;;
    arm64|aarch64) echo "aarch64" ;;
    *)
      echo "Unsupported CPU architecture for JDK install: $(uname -m)" >&2
      exit 1
      ;;
  esac
}

if [[ -x "$JDK_ROOT/bin/java" ]]; then
  echo "JDK already available in $JDK_ROOT"
  exit 0
fi

require_command "curl" "Install curl before provisioning a repo-local JDK."
require_command "tar" "Install tar before provisioning a repo-local JDK."

os="$(detect_jdk_os)"
arch="$(detect_jdk_arch)"
default_archive_url="https://api.adoptium.net/v3/binary/latest/21/ga/${os}/${arch}/jdk/hotspot/normal/eclipse"
archive_url="${JDK_DOWNLOAD_URL:-$default_archive_url}"

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

mkdir -p "$JDK_PARENT"

echo "Installing repo-local JDK into $JDK_ROOT"
echo "Downloading JDK from $archive_url"
curl -fsSL "$archive_url" -o "$tmp_dir/jdk.tar.gz"
tar -xzf "$tmp_dir/jdk.tar.gz" -C "$tmp_dir"

extracted_entries=("$tmp_dir"/*)
selected_dir=""
for entry in "${extracted_entries[@]}"; do
  if [[ -d "$entry" && "$entry" != "$tmp_dir" ]]; then
    selected_dir="$entry"
    break
  fi
done

if [[ -z "$selected_dir" ]]; then
  echo "Failed to locate extracted JDK in downloaded archive." >&2
  exit 1
fi

source_dir=""
if [[ -x "$selected_dir/bin/java" ]]; then
  source_dir="$selected_dir"
elif [[ -x "$selected_dir/Contents/Home/bin/java" ]]; then
  source_dir="$selected_dir/Contents/Home"
fi

if [[ -z "$source_dir" ]]; then
  echo "Failed to locate extracted JDK in downloaded archive." >&2
  exit 1
fi

rm -rf "$JDK_ROOT"
mv "$source_dir" "$JDK_ROOT"

echo "Repo-local JDK ready: $JDK_ROOT"
