#!/usr/bin/env bash
# Provisions the full Android toolchain for cloud workspaces:
# JDK, Android SDK, local.properties, and Gradle cache warmup.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$APP_ROOT/../.." && pwd)"

export JAVA_HOME="${JAVA_HOME:-$REPO_ROOT/.jdk/current}"
mkdir -p "$REPO_ROOT/.jdk"

bash "$SCRIPT_DIR/install-jdk.sh"

if [[ -x "$JAVA_HOME/bin/java" ]]; then
  case ":$PATH:" in
    *":$JAVA_HOME/bin:"*) ;;
    *) export PATH="$JAVA_HOME/bin:$PATH" ;;
  esac
fi

bash "$SCRIPT_DIR/setup-android-sdk.sh"

if [[ -x "$APP_ROOT/gradlew" ]]; then
  bash "$APP_ROOT/gradlew" --no-daemon -p "$APP_ROOT" help >/dev/null
fi
