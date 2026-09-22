#!/usr/bin/env bash
# Bootstrap a Linux AI-agent VM so it can develop, migrate, build, and run Notes.
#
# This is the portable startup command for cloud coding agents that are not
# Cursor Cloud (Cursor uses .cursor/environment.json + cloud-agent-install.sh
# / cloud-agent-start.sh). It is idempotent and safe to rerun.
#
# Default (no phase flags): install + start + env + migrate
#
#   bash scripts/agent-env-setup.sh
#   bash scripts/agent-env-setup.sh --android --verify
#   source .agent-env.sh
#   pnpm --filter notes-next dev
#
# See docs/operations/agent-environment.md.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PNPM_VERSION="10.28.1"
NODE_MIN_MAJOR=20
NODE_FALLBACK_VERSION="20.20.2"
LOCAL_NOTES_URL="postgres:///notes?host=/var/run/postgresql"
LOCAL_TEST_URL="postgres:///notes_test?host=/var/run/postgresql"
AGENT_ENV_FILE="$ROOT_DIR/.agent-env.sh"
APP_ENV_FILE="$ROOT_DIR/apps/notes-next/.env.local"
DEV_LOG_FILE="$ROOT_DIR/.agent-notes-next.log"
DEV_PID_FILE="$ROOT_DIR/.agent-notes-next.pid"
DEV_PORT=6000

DO_INSTALL=0
DO_START=0
DO_ENV=0
DO_MIGRATE=0
DO_ANDROID=0
DO_DEV=0
DO_VERIFY=0
SKIP_DEPS=0
HAVE_PHASE=0

usage() {
  cat <<'EOF'
Usage: bash scripts/agent-env-setup.sh [options]

Prepare a Linux AI-agent environment to work with this repo: system tools,
Node.js >= 20, pnpm, PostgreSQL 17 + pgvector, local throwaway Notes
databases, Auth.js secret, and applied schema.

With no phase flags, runs: --install --start --env --migrate

Phase flags (when any are passed, only those phases run):
  --install     System packages, Node.js, pnpm, workspace dependencies
  --start       Start PostgreSQL 17 and create notes / notes_test
  --env         Write .agent-env.sh and apps/notes-next/.env.local
  --migrate     Apply Notes schema to the local notes database

Modifiers (always additive):
  --android     Also provision the repo-local JDK / Android SDK
  --dev         Start notes-next on port 6000 after setup
  --verify      Run pnpm run diagnose:notes after setup
  --skip-deps   Skip pnpm install during --install
  -h, --help    Show this help

After setup, new shells should:
  source .agent-env.sh
EOF
}

log() {
  printf '==> %s\n' "$*"
}

warn() {
  printf 'warning: %s\n' "$*" >&2
}

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --install) DO_INSTALL=1; HAVE_PHASE=1 ;;
    --start) DO_START=1; HAVE_PHASE=1 ;;
    --env) DO_ENV=1; HAVE_PHASE=1 ;;
    --migrate) DO_MIGRATE=1; HAVE_PHASE=1 ;;
    --android) DO_ANDROID=1 ;;
    --dev) DO_DEV=1 ;;
    --verify) DO_VERIFY=1 ;;
    --skip-deps) SKIP_DEPS=1 ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage >&2
      die "Unknown option: $1"
      ;;
  esac
  shift
done

if [[ $HAVE_PHASE -eq 0 ]]; then
  DO_INSTALL=1
  DO_START=1
  DO_ENV=1
  DO_MIGRATE=1
fi

as_root() {
  if [[ "$(id -u)" -eq 0 ]]; then
    "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo "$@"
  else
    die "Need root privileges to run: $*"
  fi
}

append_path() {
  local dir="$1"
  [[ -d "$dir" ]] || return 0
  case ":$PATH:" in
    *":$dir:"*) ;;
    *) export PATH="$dir:$PATH" ;;
  esac
}

discover_node() {
  if command -v node >/dev/null 2>&1; then
    return 0
  fi

  local candidate home
  for home in "${HOME:-}" /home/ubuntu /root; do
    [[ -n "$home" ]] || continue
    for candidate in "$home/.nvm/versions/node/"*/bin "$home/.local/node/bin"; do
      if [[ -x "$candidate/node" ]]; then
        append_path "$candidate"
        return 0
      fi
    done
  done
  return 1
}

node_major() {
  local version
  version="$(node -p 'process.versions.node' 2>/dev/null || true)"
  [[ -n "$version" ]] || return 1
  printf '%s\n' "${version%%.*}"
}

ensure_os_hint() {
  [[ -f /etc/os-release ]] || return 0
  # shellcheck disable=SC1091
  . /etc/os-release
  case "${ID_LIKE:-${ID:-}}" in
    *debian*|*ubuntu*) ;;
    *)
      warn "This script targets Debian/Ubuntu. Detected ${PRETTY_NAME:-${ID:-unknown}}."
      ;;
  esac
}

ensure_system_packages() {
  command -v apt-get >/dev/null 2>&1 || return 0

  local packages=(
    ca-certificates
    curl
    git
    python3
    build-essential
    xz-utils
    openssl
  )
  local missing=()
  local pkg
  for pkg in "${packages[@]}"; do
    if ! dpkg-query -W -f='${Status}' "$pkg" 2>/dev/null | grep -q 'install ok installed'; then
      missing+=("$pkg")
    fi
  done

  if [[ ${#missing[@]} -eq 0 ]]; then
    log "System packages already present."
    return 0
  fi

  log "Installing system packages: ${missing[*]}"
  as_root apt-get update -qq
  as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y "${missing[@]}"
}

install_node_tarball() {
  local arch node_arch prefix archive url tmp
  arch="$(uname -m)"
  case "$arch" in
    x86_64) node_arch="x64" ;;
    aarch64|arm64) node_arch="arm64" ;;
    *) die "Unsupported architecture for Node.js fallback install: $arch" ;;
  esac

  prefix="${HOME}/.local/node"
  archive="node-v${NODE_FALLBACK_VERSION}-linux-${node_arch}.tar.xz"
  url="https://nodejs.org/dist/v${NODE_FALLBACK_VERSION}/${archive}"
  tmp="$(mktemp -d)"

  log "Installing Node.js ${NODE_FALLBACK_VERSION} (${node_arch}) into ${prefix}"
  mkdir -p "$prefix"
  curl -fsSL "$url" -o "$tmp/$archive"
  tar -xJf "$tmp/$archive" -C "$prefix" --strip-components=1
  rm -rf "$tmp"
  append_path "$prefix/bin"
}

ensure_node() {
  discover_node || true

  local major
  if command -v node >/dev/null 2>&1; then
    major="$(node_major || true)"
    if [[ -n "${major:-}" && "$major" -ge $NODE_MIN_MAJOR ]]; then
      log "Using existing Node.js $(node -v)"
      return 0
    fi
    warn "Node.js $(node -v 2>/dev/null || echo unknown) is below v${NODE_MIN_MAJOR}. Installing ${NODE_FALLBACK_VERSION}."
  else
    log "Node.js not found. Installing ${NODE_FALLBACK_VERSION}."
  fi

  command -v curl >/dev/null 2>&1 || die "curl is required to install Node.js"
  command -v tar >/dev/null 2>&1 || die "tar is required to install Node.js"
  install_node_tarball
  command -v node >/dev/null 2>&1 || die "Node.js install did not put node on PATH"
  major="$(node_major || true)"
  [[ -n "${major:-}" && "$major" -ge $NODE_MIN_MAJOR ]] || die "Node.js $(node -v) is still below v${NODE_MIN_MAJOR}"
  log "Node.js ready: $(node -v)"
}

ensure_pnpm_path() {
  export CI="${CI:-true}"
  export COREPACK_ENABLE_DOWNLOAD_PROMPT="${COREPACK_ENABLE_DOWNLOAD_PROMPT:-0}"
  export HUSKY="${HUSKY:-0}"
  export TURBO_TELEMETRY_DISABLED="${TURBO_TELEMETRY_DISABLED:-1}"
  export PNPM_HOME="${PNPM_HOME:-$HOME/.local/share/pnpm}"
  export PNPM_STORE_DIR="${PNPM_STORE_DIR:-$ROOT_DIR/.pnpm-store}"
  mkdir -p "$PNPM_HOME" "$PNPM_STORE_DIR" "$ROOT_DIR/.turbo"
  append_path "$PNPM_HOME"
  append_path "/usr/lib/postgresql/17/bin"
}

ensure_pnpm() {
  ensure_pnpm_path
  command -v node >/dev/null 2>&1 || die "Node.js is required before activating pnpm"
  if command -v corepack >/dev/null 2>&1; then
    corepack enable
    corepack prepare "pnpm@${PNPM_VERSION}" --activate
  elif ! command -v pnpm >/dev/null 2>&1; then
    die "corepack is missing and pnpm is not installed"
  fi
  command -v pnpm >/dev/null 2>&1 || die "pnpm is not on PATH"
  log "pnpm ready: $(pnpm --version)"
}

read_env_value() {
  local file="$1"
  local key="$2"
  [[ -f "$file" ]] || return 0
  local line
  line="$(grep -E "^${key}=" "$file" | tail -n 1 || true)"
  [[ -n "$line" ]] || return 0
  line="${line#*=}"
  line="${line%\"}"
  line="${line#\"}"
  line="${line%\'}"
  line="${line#\'}"
  printf '%s\n' "$line"
}

upsert_kv() {
  local file="$1"
  local key="$2"
  local value="$3"
  local tmp
  mkdir -p "$(dirname "$file")"
  touch "$file"
  tmp="$(mktemp)"
  awk -v k="$key" -v v="$value" '
    BEGIN { done = 0 }
    $0 ~ ("^" k "=") {
      if (!done) {
        print k "=" v
        done = 1
      }
      next
    }
    { print }
    END {
      if (!done) print k "=" v
    }
  ' "$file" > "$tmp"
  mv "$tmp" "$file"
}

generate_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
    return 0
  fi
  if command -v node >/dev/null 2>&1; then
    node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("hex"))'
    return 0
  fi
  head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'
  printf '\n'
}

existing_secret() {
  local value
  value="${AUTH_SECRET:-}"
  if [[ -z "$value" ]]; then
    value="$(read_env_value "$APP_ENV_FILE" AUTH_SECRET)"
  fi
  if [[ -z "$value" ]]; then
    value="$(read_env_value "$ROOT_DIR/apps/notes-next/.env" AUTH_SECRET)"
  fi
  if [[ -z "$value" ]]; then
    value="$(read_env_value "$AGENT_ENV_FILE" AUTH_SECRET)"
  fi
  printf '%s\n' "$value"
}

write_env_files() {
  export DB_NOTES_URL="${DB_NOTES_URL:-$LOCAL_NOTES_URL}"
  export DB_NOTES_TEST_URL="${DB_NOTES_TEST_URL:-$LOCAL_TEST_URL}"
  export AUTH_TRUST_HOST="${AUTH_TRUST_HOST:-true}"
  export AUTH_SECRET="${AUTH_SECRET:-$(existing_secret)}"
  if [[ -z "$AUTH_SECRET" ]]; then
    AUTH_SECRET="$(generate_secret)"
    export AUTH_SECRET
  fi

  ensure_pnpm_path

  cat > "$AGENT_ENV_FILE" <<EOF
# Generated by scripts/agent-env-setup.sh. Do not commit.
# Usage: source .agent-env.sh
export CI="${CI}"
export HUSKY="${HUSKY}"
export COREPACK_ENABLE_DOWNLOAD_PROMPT="${COREPACK_ENABLE_DOWNLOAD_PROMPT}"
export TURBO_TELEMETRY_DISABLED="${TURBO_TELEMETRY_DISABLED}"
export PNPM_HOME="${PNPM_HOME}"
export PNPM_STORE_DIR="${PNPM_STORE_DIR}"
export PATH="${PNPM_HOME}:/usr/lib/postgresql/17/bin:\$PATH"
export DB_NOTES_URL="${DB_NOTES_URL}"
export DB_NOTES_TEST_URL="${DB_NOTES_TEST_URL}"
export AUTH_SECRET="${AUTH_SECRET}"
export AUTH_TRUST_HOST="${AUTH_TRUST_HOST}"
EOF

  if [[ -n "${JINA_API_KEY:-}" ]]; then
    printf 'export JINA_API_KEY=%q\n' "$JINA_API_KEY" >> "$AGENT_ENV_FILE"
  fi
  if [[ -n "${JAVA_HOME:-}" ]]; then
    printf 'export JAVA_HOME=%q\n' "$JAVA_HOME" >> "$AGENT_ENV_FILE"
    printf 'export PATH=%q:"$PATH"\n' "$JAVA_HOME/bin" >> "$AGENT_ENV_FILE"
  fi
  if [[ -n "${ANDROID_HOME:-}" ]]; then
    printf 'export ANDROID_HOME=%q\n' "$ANDROID_HOME" >> "$AGENT_ENV_FILE"
    printf 'export ANDROID_USER_HOME=%q\n' "${ANDROID_USER_HOME:-$ROOT_DIR/.android-user-home}" >> "$AGENT_ENV_FILE"
    printf 'export GRADLE_USER_HOME=%q\n' "${GRADLE_USER_HOME:-$ROOT_DIR/.gradle}" >> "$AGENT_ENV_FILE"
  fi

  upsert_kv "$APP_ENV_FILE" "DB_NOTES_URL" "$DB_NOTES_URL"
  upsert_kv "$APP_ENV_FILE" "DB_NOTES_TEST_URL" "$DB_NOTES_TEST_URL"
  upsert_kv "$APP_ENV_FILE" "AUTH_SECRET" "$AUTH_SECRET"
  upsert_kv "$APP_ENV_FILE" "AUTH_TRUST_HOST" "$AUTH_TRUST_HOST"
  if [[ -n "${JINA_API_KEY:-}" ]]; then
    upsert_kv "$APP_ENV_FILE" "JINA_API_KEY" "$JINA_API_KEY"
  fi

  log "Wrote ${AGENT_ENV_FILE} and ${APP_ENV_FILE}"
}

port_in_use() {
  local port="$1"
  if command -v ss >/dev/null 2>&1; then
    ss -ltn "sport = :${port}" 2>/dev/null | grep -q ":${port}"
    return $?
  fi
  if command -v lsof >/dev/null 2>&1; then
    lsof -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
    return $?
  fi
  return 1
}

wait_for_health() {
  local url="http://127.0.0.1:${DEV_PORT}/api/health"
  local i
  for i in $(seq 1 60); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

start_dev_server() {
  ensure_pnpm_path
  discover_node || true
  export DB_NOTES_URL="${DB_NOTES_URL:-$LOCAL_NOTES_URL}"
  export DB_NOTES_TEST_URL="${DB_NOTES_TEST_URL:-$LOCAL_TEST_URL}"
  export AUTH_SECRET="${AUTH_SECRET:-$(existing_secret)}"
  export AUTH_TRUST_HOST="${AUTH_TRUST_HOST:-true}"

  if [[ -f "$DEV_PID_FILE" ]] && kill -0 "$(cat "$DEV_PID_FILE")" 2>/dev/null; then
    log "notes-next already running (pid $(cat "$DEV_PID_FILE"))"
    return 0
  fi
  if port_in_use "$DEV_PORT"; then
    log "Port ${DEV_PORT} is already in use; not starting a second notes-next."
    return 0
  fi

  command -v pnpm >/dev/null 2>&1 || die "pnpm is required to start notes-next"
  log "Starting notes-next on http://127.0.0.1:${DEV_PORT}"
  nohup pnpm --filter notes-next dev > "$DEV_LOG_FILE" 2>&1 &
  echo $! > "$DEV_PID_FILE"
  if wait_for_health; then
    log "notes-next is healthy at http://127.0.0.1:${DEV_PORT}/api/health"
  else
    warn "notes-next did not become healthy. Inspect ${DEV_LOG_FILE}"
    return 1
  fi
}

print_ready() {
  cat <<EOF

Workspace ready for AI-agent work.

Environment files:
  ${AGENT_ENV_FILE}
  ${APP_ENV_FILE}

Database:
  DB_NOTES_URL=${DB_NOTES_URL:-$LOCAL_NOTES_URL}
  DB_NOTES_TEST_URL=${DB_NOTES_TEST_URL:-$LOCAL_TEST_URL}

In every new shell:
  source .agent-env.sh

Recommended commands:
  pnpm --filter notes-next dev          # http://localhost:${DEV_PORT}
  pnpm --filter notes-next test
  pnpm --filter notes-next build
  pnpm --filter @lib/db-notes test
  pnpm run diagnose:notes
  pnpm run verify:notes-web

Optional:
  export JINA_API_KEY=...               # required only for semantic search
  bash scripts/agent-env-setup.sh --android
  bash scripts/agent-env-setup.sh --dev
EOF
}

ensure_os_hint
ensure_pnpm_path
discover_node || true

if [[ $DO_INSTALL -eq 1 ]]; then
  log "Install: system tools, Node.js, PostgreSQL packages, workspace deps"
  ensure_system_packages
  ensure_node
  ensure_pnpm
  bash "$ROOT_DIR/scripts/cloud-agent-postgres.sh" install
  if [[ $SKIP_DEPS -eq 0 ]]; then
    bash "$ROOT_DIR/scripts/install-workspace-deps.sh"
  else
    log "Skipping workspace dependency install (--skip-deps)."
  fi
fi

if [[ $DO_ANDROID -eq 1 ]]; then
  log "Provisioning Android toolchain"
  ensure_node
  bash "$ROOT_DIR/apps/notes-android/tools/cloud-provision.sh"
  export JAVA_HOME="${JAVA_HOME:-$ROOT_DIR/.jdk/current}"
  export ANDROID_HOME="${ANDROID_HOME:-$ROOT_DIR/.android-sdk}"
  export ANDROID_USER_HOME="${ANDROID_USER_HOME:-$ROOT_DIR/.android-user-home}"
  export GRADLE_USER_HOME="${GRADLE_USER_HOME:-$ROOT_DIR/.gradle}"
fi

if [[ $DO_START -eq 1 ]]; then
  log "Starting local PostgreSQL 17 and throwaway Notes databases"
  bash "$ROOT_DIR/scripts/cloud-agent-postgres.sh" start
fi

if [[ $DO_ENV -eq 1 ]]; then
  log "Writing local agent environment files"
  write_env_files
fi

if [[ $DO_MIGRATE -eq 1 ]]; then
  log "Applying Notes migrations to the local database"
  discover_node || true
  ensure_pnpm
  export DB_NOTES_URL="${DB_NOTES_URL:-$LOCAL_NOTES_URL}"
  export DB_NOTES_TEST_URL="${DB_NOTES_TEST_URL:-$LOCAL_TEST_URL}"
  pnpm run db:migrate
fi

if [[ $DO_DEV -eq 1 ]]; then
  start_dev_server
fi

if [[ $DO_VERIFY -eq 1 ]]; then
  log "Running diagnose:notes"
  discover_node || true
  ensure_pnpm
  export DB_NOTES_URL="${DB_NOTES_URL:-$LOCAL_NOTES_URL}"
  export DB_NOTES_TEST_URL="${DB_NOTES_TEST_URL:-$LOCAL_TEST_URL}"
  pnpm run diagnose:notes
fi

print_ready
