#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$APP_ROOT/../.." && pwd)"
DEFAULT_ANDROID_HOME="$REPO_ROOT/.android-sdk"
DEFAULT_ANDROID_USER_HOME="$REPO_ROOT/.android-user-home"
DEFAULT_GRADLE_USER_HOME="$REPO_ROOT/.gradle"

export ANDROID_HOME="${ANDROID_HOME:-$DEFAULT_ANDROID_HOME}"

if [[ ! -d "$ANDROID_HOME" && "$ANDROID_HOME" != "$DEFAULT_ANDROID_HOME" ]]; then
  android_home_parent="$(dirname "$ANDROID_HOME")"
  if [[ ! -w "$android_home_parent" ]]; then
    echo "ANDROID_HOME=$ANDROID_HOME is not writable; falling back to $DEFAULT_ANDROID_HOME"
    export ANDROID_HOME="$DEFAULT_ANDROID_HOME"
  fi
fi

NEED_SDK_INSTALL=false
if [[ -d "$ANDROID_HOME" ]]; then
  echo "Using existing ANDROID_HOME=$ANDROID_HOME"
else
  echo "ANDROID_HOME=$ANDROID_HOME not found; will provision SDK there"
  NEED_SDK_INSTALL=true
fi

export ANDROID_USER_HOME="${ANDROID_USER_HOME:-$DEFAULT_ANDROID_USER_HOME}"
export GRADLE_USER_HOME="${GRADLE_USER_HOME:-$DEFAULT_GRADLE_USER_HOME}"

if [[ -x "$REPO_ROOT/.jdk/current/bin/java" ]]; then
  export JAVA_HOME="${JAVA_HOME:-$REPO_ROOT/.jdk/current}"
elif [[ -z "${JAVA_HOME:-}" && "$(uname -s)" == "Darwin" && -x "/usr/libexec/java_home" ]]; then
  export JAVA_HOME="$(/usr/libexec/java_home 2>/dev/null || true)"
fi

if [[ -n "${JAVA_HOME:-}" && -x "$JAVA_HOME/bin/java" ]]; then
  case ":$PATH:" in
    *":$JAVA_HOME/bin:"*) ;;
    *) export PATH="$JAVA_HOME/bin:$PATH" ;;
  esac
fi

if [[ "$NEED_SDK_INSTALL" == "true" ]]; then
  mkdir -p "$ANDROID_HOME" "$ANDROID_USER_HOME" "$GRADLE_USER_HOME"
  bash "$SCRIPT_DIR/install-android-sdk.sh"
fi

LOCAL_PROPERTIES_PATH="$APP_ROOT/local.properties"

upsert_local_property() {
  local key="$1"
  local value="$2"

  python3 - "$LOCAL_PROPERTIES_PATH" "$key" "$value" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
key = sys.argv[2]
value = sys.argv[3]
prefix = f"{key}="
replacement = f"{prefix}{value}\n"

if path.exists():
    lines = path.read_text().splitlines(keepends=True)
else:
    lines = []

updated = False
result = []

for line in lines:
    if line.startswith(prefix):
        if not updated:
            result.append(replacement)
            updated = True
        continue
    result.append(line)

if not updated:
    if result and not result[-1].endswith("\n"):
        result[-1] = f"{result[-1]}\n"
    result.append(replacement)

path.write_text("".join(result))
PY
}

upsert_local_property "sdk.dir" "$ANDROID_HOME"

echo "Android SDK: $ANDROID_HOME"
echo "Wrote $APP_ROOT/local.properties"
