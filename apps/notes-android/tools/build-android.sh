#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

source "$SCRIPT_DIR/setup-android-sdk.sh"
bash "$APP_ROOT/gradlew" --no-daemon -p "$APP_ROOT" :app:assembleDebug
