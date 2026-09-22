# Generic AI Agent Environment

Use this when a cloud coding agent that is **not** Cursor Cloud needs to
install, migrate, build, and run this monorepo. Cursor Cloud keeps using
`.cursor/environment.json` plus `scripts/cloud-agent-install.sh` and
`scripts/cloud-agent-start.sh`.

The portable entry point is:

```bash
bash scripts/agent-env-setup.sh
source .agent-env.sh
```

The script is idempotent. It is safe to rerun after a reboot or a new checkout
on the same VM.

## What it prepares

| Piece | Result |
| --- | --- |
| System tools | `curl`, `git`, `python3`, `build-essential`, `openssl` (Debian/Ubuntu) |
| Node.js | Existing `node` >= 20, otherwise official Node 20.20.2 tarball in `~/.local/node` |
| pnpm | `pnpm@10.28.1` via Corepack, then a frozen-lockfile workspace install |
| PostgreSQL | Server 17, client tools, and `pgvector` via `scripts/cloud-agent-postgres.sh` |
| Databases | Throwaway `notes` and `notes_test` on the local Unix socket |
| App env | `.agent-env.sh` (source in new shells) and `apps/notes-next/.env.local` |
| Schema | `pnpm run db:migrate` against the local `notes` database |

`AUTH_SECRET` is generated once and reused on later runs so Auth.js sessions
stay valid. `JINA_API_KEY` is copied through when already present; it is
required only for semantic search and embedding maintenance.

The script never points `DB_NOTES_URL` at a Railway or other deployed
database. Agent work stays on the VM-local throwaway cluster.

## Hook this as the other service's startup command

After the service checks out the repository, run:

```bash
bash scripts/agent-env-setup.sh
```

Equivalent package script:

```bash
pnpm run agent:setup
```

Useful variants:

```bash
# Default plus Android JDK/SDK (only if the agent will build an APK)
bash scripts/agent-env-setup.sh --android

# Default, then start notes-next and wait for /api/health
bash scripts/agent-env-setup.sh --dev

# Default, then the read-only environment diagnostic
bash scripts/agent-env-setup.sh --verify

# Per-boot only, after packages are already installed
bash scripts/agent-env-setup.sh --start --env --migrate
```

New shells do not inherit the setup process environment. Always:

```bash
source .agent-env.sh
```

`.agent-env.sh`, `.agent-notes-next.log`, and `.agent-notes-next.pid` are
gitignored.

## After setup

```bash
source .agent-env.sh
pnpm --filter notes-next dev          # http://localhost:6000
pnpm --filter notes-next test
pnpm --filter notes-next build
pnpm --filter @lib/db-notes test      # uses DB_NOTES_TEST_URL
pnpm run diagnose:notes
pnpm run verify:notes-web
```

Android is optional and slow:

```bash
bash scripts/agent-env-setup.sh --android
pnpm --filter notes-android build
```

## Requirements

- Debian or Ubuntu (apt). Other distros work only if PostgreSQL 17 + pgvector
  and Node.js >= 20 are already installed.
- Root or passwordless `sudo` for PostgreSQL packages and `pg_ctlcluster`.
- Network access to install apt packages, the Node tarball if needed, and the
  pnpm store.

## Cursor Cloud vs this script

| Concern | Cursor Cloud | Other agent VMs |
| --- | --- | --- |
| Install | `scripts/cloud-agent-install.sh` | `scripts/agent-env-setup.sh --install` |
| Per-boot services | `scripts/cloud-agent-start.sh` | `scripts/agent-env-setup.sh --start --env` |
| Env vars | `.cursor/environment.json` | `.agent-env.sh` + `apps/notes-next/.env.local` |
| Migrations | Agent runs `pnpm run db:migrate` | Included in the default setup |
| Android toolchain | Always provisioned | Only with `--android` |

`scripts/cloud-agent-postgres.sh` is shared. It accepts root without `sudo`.
