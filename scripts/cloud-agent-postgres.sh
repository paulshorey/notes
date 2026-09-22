#!/usr/bin/env bash
# Provision PostgreSQL 17 (server, client tools, pgvector) for AI-agent VMs.
#
#   bash scripts/cloud-agent-postgres.sh install  # apt packages (idempotent)
#   bash scripts/cloud-agent-postgres.sh start    # start 17/main + local DBs
#   bash scripts/cloud-agent-postgres.sh status   # versions, cluster, extensions
#
# Packages belong in `install` (durable). The postmaster belongs in `start`
# because environment-build snapshots keep files, not running processes.
# `pg_ctlcluster` is used instead of systemd; cloud VMs often have systemd
# offline, which is why `as_root pg_ctlcluster 17 main start` is the supported
# way to bring the cluster up (root directly, or sudo when not already root).
set -euo pipefail

PG_MAJOR=17
PG_CLUSTER=main
PG17_BINDIR="/usr/lib/postgresql/${PG_MAJOR}/bin"
LOCAL_DB_OWNER="postgres"
NOTES_DB="notes"
NOTES_TEST_DB="notes_test"

# Unix-socket URLs (peer auth as the workspace user). node-pg treats
# postgres:///dbname as TCP localhost, so the host query param is required.
LOCAL_NOTES_URL="postgres:///${NOTES_DB}?host=/var/run/postgresql"
LOCAL_TEST_URL="postgres:///${NOTES_TEST_DB}?host=/var/run/postgresql"

usage() {
  echo "Usage: $0 install|start|status" >&2
  exit 1
}

# Cloud agent VMs may run this as root (no sudo) or as a sudo-capable user.
as_root() {
  if [[ "$(id -u)" -eq 0 ]]; then
    "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo "$@"
  else
    echo "Need root privileges to run: $*" >&2
    exit 1
  fi
}

as_postgres() {
  if [[ "$(id -un)" == "postgres" ]]; then
    "$@"
  elif [[ "$(id -u)" -eq 0 ]] && command -v runuser >/dev/null 2>&1; then
    runuser -u postgres -- "$@"
  elif [[ "$(id -u)" -eq 0 ]]; then
    local cmd
    printf -v cmd '%q ' "$@"
    su -s /bin/bash postgres -c "$cmd"
  elif command -v sudo >/dev/null 2>&1; then
    sudo -u postgres "$@"
  else
    echo "Need to run as the postgres user: $*" >&2
    exit 1
  fi
}

add_pg17_to_path() {
  if [[ -d "$PG17_BINDIR" ]]; then
    case ":$PATH:" in
      *":$PG17_BINDIR:"*) ;;
      *) export PATH="$PG17_BINDIR:$PATH" ;;
    esac
  fi
}

pkg_installed() {
  dpkg-query -W -f='${Status}' "$1" 2>/dev/null | grep -q 'install ok installed'
}

has_pg17_clients() {
  [[ -x "${PG17_BINDIR}/psql" && -x "${PG17_BINDIR}/pg_dump" ]]
}

has_pg17_server() {
  [[ -x "${PG17_BINDIR}/postgres" && -x "${PG17_BINDIR}/pg_ctl" ]]
}

has_pgvector() {
  pkg_installed "postgresql-${PG_MAJOR}-pgvector"
}

ensure_pgdg_repo() {
  as_root apt-get update -qq
  as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y postgresql-common ca-certificates
  if [[ -x /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh ]]; then
    as_root /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y
  fi
}

install_postgres() {
  if has_pg17_clients && has_pg17_server && has_pgvector; then
    echo "PostgreSQL ${PG_MAJOR} server, client tools, and pgvector already installed."
    "${PG17_BINDIR}/psql" --version
    "${PG17_BINDIR}/pg_dump" --version
    return 0
  fi

  echo "Installing PostgreSQL ${PG_MAJOR} server, client tools, and pgvector..."
  ensure_pgdg_repo
  # Do not rely on systemd to start the cluster during apt; cloud VMs often
  # report systemd as offline. Start happens in the `start` subcommand.
  as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y \
    "postgresql-client-${PG_MAJOR}" \
    "postgresql-${PG_MAJOR}" \
    "postgresql-${PG_MAJOR}-pgvector"

  if ! has_pg17_clients || ! has_pg17_server || ! has_pgvector; then
    echo "PostgreSQL ${PG_MAJOR} install did not produce the expected binaries/packages." >&2
    echo "  postgres: ${PG17_BINDIR}/postgres" >&2
    echo "  psql:     ${PG17_BINDIR}/psql" >&2
    echo "  pgvector: postgresql-${PG_MAJOR}-pgvector" >&2
    exit 1
  fi

  echo "PostgreSQL server ready: $("${PG17_BINDIR}/postgres" --version)"
  echo "PostgreSQL client tools ready: $("${PG17_BINDIR}/psql" --version)"
  echo "pg_dump ready: $("${PG17_BINDIR}/pg_dump" --version)"
}

cluster_line() {
  # pg_lsclusters -h: Ver Cluster Port Status Owner Data directory Log file
  pg_lsclusters -h 2>/dev/null | awk -v major="$PG_MAJOR" -v name="$PG_CLUSTER" \
    '$1 == major && $2 == name { print; found=1 } END { exit found ? 0 : 1 }'
}

cluster_status() {
  local line
  if ! line="$(cluster_line)"; then
    echo "absent"
    return 0
  fi
  awk '{ print $4 }' <<<"$line"
}

ensure_cluster() {
  local status
  status="$(cluster_status)"

  if [[ "$status" == "absent" ]]; then
    echo "Creating PostgreSQL ${PG_MAJOR}/${PG_CLUSTER} cluster..."
    as_root pg_createcluster "$PG_MAJOR" "$PG_CLUSTER"
    status="$(cluster_status)"
  fi

  if [[ "$status" != "online" ]]; then
    echo "Starting PostgreSQL ${PG_MAJOR}/${PG_CLUSTER}..."
    as_root pg_ctlcluster "$PG_MAJOR" "$PG_CLUSTER" start
  fi
}

wait_for_ready() {
  local i
  for i in $(seq 1 30); do
    if as_postgres "${PG17_BINDIR}/pg_isready" -q; then
      return 0
    fi
    sleep 1
  done

  echo "PostgreSQL ${PG_MAJOR}/${PG_CLUSTER} did not become ready." >&2
  pg_lsclusters >&2 || true
  exit 1
}

psql_as_postgres() {
  as_postgres env PATH="${PG17_BINDIR}:$PATH" psql -v ON_ERROR_STOP=1 "$@"
}

ensure_role() {
  local os_user="$1"
  if [[ ! "$os_user" =~ ^[a-z_][a-z0-9_-]*$ || "$os_user" == "postgres" ]]; then
    return 0
  fi
  if ! id -u "$os_user" >/dev/null 2>&1; then
    return 0
  fi
  psql_as_postgres -Atqc \
    "SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = '${os_user}'" | grep -q 1 \
    || psql_as_postgres -c "CREATE ROLE ${os_user} WITH SUPERUSER LOGIN;"
}

ensure_workspace_roles() {
  # This script may run as root while the agent's shell runs as ubuntu (or the
  # reverse), and peer auth needs a role named after whoever opens the socket.
  local os_user
  for os_user in "$(id -un)" root ubuntu; do
    ensure_role "$os_user"
  done
}

ensure_database() {
  local db_name="$1"
  local exists
  exists="$(psql_as_postgres -Atqc "SELECT 1 FROM pg_database WHERE datname = '${db_name}'")"
  if [[ "$exists" != "1" ]]; then
    echo "Creating database ${db_name}..."
    as_postgres env PATH="${PG17_BINDIR}:$PATH" createdb -O "$LOCAL_DB_OWNER" "$db_name"
  fi
  psql_as_postgres -d "$db_name" -qc "SET client_min_messages = warning; CREATE EXTENSION IF NOT EXISTS vector;" >/dev/null
}

start_postgres() {
  if ! has_pg17_server; then
    echo "PostgreSQL ${PG_MAJOR} server is not installed. Run: bash scripts/cloud-agent-postgres.sh install" >&2
    exit 1
  fi

  if ! has_pgvector; then
    echo "postgresql-${PG_MAJOR}-pgvector is not installed. Run: bash scripts/cloud-agent-postgres.sh install" >&2
    exit 1
  fi

  add_pg17_to_path
  ensure_cluster
  wait_for_ready
  ensure_workspace_roles
  ensure_database "$NOTES_DB"
  ensure_database "$NOTES_TEST_DB"

  echo "PostgreSQL ${PG_MAJOR}/${PG_CLUSTER} is online."
  echo "  psql ${NOTES_DB}                          # peer auth as $(id -un)"
  echo "  DB_NOTES_URL=${LOCAL_NOTES_URL}"
  echo "  DB_NOTES_TEST_URL=${LOCAL_TEST_URL}"
}

print_status() {
  add_pg17_to_path
  echo "psql:    $(command -v psql 2>/dev/null || echo missing)"
  echo "pg_dump: $(command -v pg_dump 2>/dev/null || echo missing)"
  if has_pg17_clients; then
    "${PG17_BINDIR}/psql" --version
    "${PG17_BINDIR}/pg_dump" --version
  else
    echo "PostgreSQL ${PG_MAJOR} client binaries are not installed."
  fi
  if has_pg17_server; then
    "${PG17_BINDIR}/postgres" --version
  else
    echo "PostgreSQL ${PG_MAJOR} server is not installed."
  fi
  if has_pgvector; then
    echo "pgvector package: postgresql-${PG_MAJOR}-pgvector"
  else
    echo "pgvector package: missing"
  fi
  echo "clusters:"
  pg_lsclusters || true

  if [[ "$(cluster_status)" == "online" ]]; then
    echo "pg_isready: $(as_postgres "${PG17_BINDIR}/pg_isready" || true)"
    echo "vector extension (notes):"
    psql_as_postgres -d "$NOTES_DB" -Atqc \
      "SELECT extversion FROM pg_extension WHERE extname = 'vector'" \
      || echo "  (unable to query)"
  fi
}

if [[ $# -ne 1 ]]; then
  usage
fi

case "$1" in
  install) install_postgres ;;
  start) start_postgres ;;
  status) print_status ;;
  *) usage ;;
esac
