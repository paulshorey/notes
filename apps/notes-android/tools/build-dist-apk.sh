#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DIST_DIR="$APP_ROOT/dist"
CANONICAL_APK="$DIST_DIR/notes-android.apk"
DEBUG_APK_DIR="$APP_ROOT/app/build/outputs/apk/debug"

bash "$SCRIPT_DIR/build-android.sh"

shopt -s nullglob
debug_apks=("$DEBUG_APK_DIR"/*-debug.apk)
shopt -u nullglob

if [[ "${#debug_apks[@]}" -ne 1 ]]; then
  echo "Expected exactly one debug APK in $DEBUG_APK_DIR, found ${#debug_apks[@]}." >&2
  exit 1
fi

mkdir -p "$DIST_DIR"
rm -f "$DIST_DIR"/*.apk
cp "${debug_apks[0]}" "$CANONICAL_APK"

echo "Installable APK written to $CANONICAL_APK"
