# Notes Monorepo

Monorepo for the Notes web app and its shared packages:

- `apps/notes-next` - Notes web app and REST API, deployed to Railway

`lib/db-items` is the source of truth for the item database schema, generated contracts, and shared item workflows.

The web app presents text items as notes. Internals use `ItemRecord`, item services,
and `/api/items`; existing clients keep working through compatibility adapters.
See [the item core design](docs/db/item-core.md). `DB_NOTES_URL` remains a supported
fallback for deployed environments during rollout.

`lib/atomic-editor` is the markdown editor package used by `notes-next`. It is vendored as regular files via **git subtree** (not a submodule), and can optionally be synced with the standalone fork [`paulshorey/atomic-editor`](https://github.com/paulshorey/atomic-editor).

## Script ownership

All day-to-day developer workflows run from the repo root. Each command is a thin wrapper around the real work in the appropriate package, so you do not have to remember `pnpm --filter <pkg> ...` invocations.

### Install and verify

| Command                        | What it does                                                                            |
| ------------------------------ | --------------------------------------------------------------------------------------- |
| `pnpm run deps:install`        | Install all workspace dependencies (Turbo / pnpm).                                      |
| `pnpm run verify`              | Repo-wide pre-push gate. Runs `verify:db-contracts` then `verify:notes-web`.            |
| `pnpm run verify:db-contracts` | Type-check `lib/db-items` and confirm generated item contract artifacts are up to date. |
| `pnpm run verify:notes-web`    | `notes-next`: type-check, tests, and production build.                                  |

### Build

| Command                    | What it does                           |
| -------------------------- | -------------------------------------- |
| `pnpm run build`           | Turbo `build` across every package.    |
| `pnpm run build:notes-web` | Production build of `apps/notes-next`. |

### Database (`lib/db-items`)

| Command                             | What it does                                                                                                                                                                      |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm run db:migrate`               | Bring the Notes database at `DB_ITEMS_URL` up to the latest tracked schema.                                                                                                       |
| `pnpm run db:migrate:baseline`      | Legacy recovery tool: mark baseline migrations as applied for a legacy Notes DB that already has the baseline schema but has never been tracked. Not part of normal release flow. |
| `pnpm run db:verify`                | Re-run migrations then regenerate and diff contract artifacts against the live DB. Not read-only.                                                                                 |
| `pnpm run db:embeddings:regenerate` | Rebuild stale Notes embeddings. Only needed when search data drifts or embedding format changes.                                                                                  |

The real scripts live in `lib/db-items/package.json`. App packages do not own migration scripts.

### Release preparation

| Command                          | What it does                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------------- |
| `pnpm run release:notes:prepare` | `verify:db-contracts` + `verify:notes-web`. Run before a `notes-next` Railway deploy. |

## Apps and deploy targets

| Path              | Deploy target | Depends on `lib/db-items` |
| ----------------- | ------------- | ------------------------- |
| `apps/notes-next` | Railway       | Yes                       |

## Environment variables

| Variable       | Used by                           | Purpose                                                                                                                                                     |
| -------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DB_ITEMS_URL` | `lib/db-items`, `apps/notes-next` | PostgreSQL connection string for Notes. Set in your shell when running `db:`\* commands or `notes-next` locally; set in the Railway service for production. |
| `JINA_API_KEY` | `lib/db-items`, `apps/notes-next` | Jina embeddings key for semantic search and embedding maintenance.                                                                                          |

## Development setup

### Prerequisites

- Node.js 20+
- pnpm 10.x
- PostgreSQL 17 client tools (`psql`, `pg_dump`) for `db:verify` and schema snapshots

### Cloud AI agent VM

On a fresh Debian/Ubuntu coding-agent machine, one command prepares the
toolchain, local PostgreSQL 17 + pgvector, throwaway Notes databases, and
schema:

```bash
bash scripts/agent-env-setup.sh
source .agent-env.sh
```

See [`docs/operations/agent-environment.md`](docs/operations/agent-environment.md).

### Install dependencies

```bash
pnpm run deps:install
```

Focused installs are still available:

```bash
pnpm run deps:install -- notes-next...
```

### Local app entry points

```bash
pnpm --filter notes-next dev         # http://localhost:4100
```

`notes-next` needs `DB_ITEMS_URL` and `JINA_API_KEY` in its shell (or `apps/notes-next/.env.local`).

See the package README files for package-specific setup:

- `[apps/notes-next/README.md](apps/notes-next/README.md)`
- `[lib/db-items/README.md](lib/db-items/README.md)`
- `[lib/atomic-editor/README.md](lib/atomic-editor/README.md)`

## Daily development loop

A normal feature cycle looks like this:

```bash
pnpm run deps:install                # once per checkout, and after dependency changes
pnpm --filter <pkg> dev              # iterate on the relevant app

# before opening or updating a PR
pnpm run verify                      # repo-wide gate
```

If you changed the Notes schema or any `lib/db-items` contract:

```bash
export DB_ITEMS_URL=postgres://.../<your dev db>
pnpm run db:migrate                  # apply your new migration
pnpm run db:verify                   # regenerate and diff contract artifacts
git add lib/db-items/generated   # commit regenerated artifacts with the migration
```

## `lib/atomic-editor` (git subtree)

`lib/atomic-editor` is a fork of [`kenforthewin/atomic-editor`](https://github.com/kenforthewin/atomic-editor), committed directly in this monorepo as normal files. It is linked to [`paulshorey/atomic-editor`](https://github.com/paulshorey/atomic-editor) with **git subtree** so you can sync on demand. Fresh clones, CI, and Railway need no submodule init step.

### Day-to-day (no sync required)

Edit `lib/atomic-editor/` like any other workspace package, commit on your monorepo branch, and push to `origin`. Nothing subtree-related happens unless you run the sync script.

```bash
# while editing editor source
pnpm --filter @atomic-editor/editor exec tsc -w -p tsconfig.build.json
pnpm --filter notes-next dev
```

Build output goes to `lib/atomic-editor/dist/` (gitignored). `notes-next` builds the editor first. Peer deps (`@codemirror/*`, `react`) resolve from `notes-next` — do not add duplicate copies in this package.

Keep editor-focused commit messages if you might later push commits to the fork (those messages are preserved verbatim on the fork and in upstream PRs).

### Sync with the fork (on demand)

Use the wrapper script from the repo root. Do **not** pass `--squash`.

| Command                                                 | Direction              | Effect                                                                                                                                          |
| ------------------------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `bash scripts/atomic-editor-sync.sh push <fork-branch>` | monorepo → fork        | Creates/updates `<fork-branch>` on `paulshorey/atomic-editor`. **Does not change this monorepo.** Prefer a new feature branch name, not `main`. |
| `bash scripts/atomic-editor-sync.sh pull`               | fork `main` → monorepo | Merges fork changes into `lib/atomic-editor/` and creates a merge commit here.                                                                  |
| `bash scripts/atomic-editor-sync.sh pull <fork-branch>` | fork branch → monorepo | Same as pull, from a specific fork branch.                                                                                                      |

**Pull requires a clean working tree** (`git status` must show nothing to commit). Commit or stash local changes first, or you will get `fatal: working tree has modifications. Cannot add.`

Push and pull are independent: you do not need to push monorepo editor work to the fork before pulling fork updates. Push when you want editor commits on the fork (for publishing or opening a PR to upstream). Pull when you want fork/upstream changes brought into this repo.

Typical contribute-upstream flow:

```bash
# develop and commit under lib/atomic-editor/ in this monorepo, then:
bash scripts/atomic-editor-sync.sh push my-editor-fix
# open a PR from paulshorey/atomic-editor:my-editor-fix → kenforthewin/atomic-editor
```

Typical bring-fork-updates flow:

```bash
git status   # must be clean
bash scripts/atomic-editor-sync.sh pull
# resolve any merge conflicts under lib/atomic-editor/, then push origin
```

Full details (what each repo changes, non-squash rationale, troubleshooting): [`docs/atomic-editor/git-subtree.md`](docs/atomic-editor/git-subtree.md).

## Migrations

All Notes DB migrations live in `lib/db-items`.

Run migrations in these cases:

- Run `pnpm run db:migrate` when the target Notes database should be brought up to the latest tracked schema.
- Run `pnpm run db:verify` on a clean feature branch after schema changes, before merge, to confirm the migration files, generated artifacts, and structural assertions still match.
- Run `pnpm run db:migrate:baseline` only once for a legacy Notes database that already has the baseline schema but has never been placed under migration tracking.
- Run `pnpm run db:embeddings:regenerate` only when Notes search data is stale or the embedding/text format changed.

Do not put Notes migration scripts in `apps/notes-next`. The app consumes the DB contract; it does not own it.

## Production release order

If production is stale and you want to promote the newest repo state, use the flow below.

### 1. Common preflight

```bash
pnpm run deps:install
pnpm run verify
```

`pnpm run verify` checks the DB contract package and `notes-next` with package-specific checks.

### 2. Notes web / API (`apps/notes-next`)

Use this when Notes code, schema, or search maintenance changed.

For the code-only preparation step, you can run:

```bash
pnpm run release:notes:prepare
```

Deploy `apps/notes-next` on Railway after this preparation. The committed
pre-deploy command applies tracked item migrations before the release becomes
healthy; `.railway/railway.ts` owns the desired settings. Existing applied settings
that still reference `@lib/db-notes` work through its migration-command adapter.

Manual migration or verification against a deployed database is an intentional
operational action that requires explicit authorization and confirmation of the
actual target. `db:verify` runs migrations and rewrites local artifacts, so normal
contract checks belong on an isolated development database before merge. Use
`db:migrate:baseline` only once for a legacy untracked database that already has
the baseline schema. Regenerate embeddings separately if search data needs repair.

See [the item core rollout](docs/db/item-core.md) and
[the environment matrix](docs/operations/notes-environments.md).

## Troubleshooting

- **`git subtree` / `atomic-editor-sync.sh pull` fails with `working tree has modifications. Cannot add.`** The working tree must be clean. Run `git status`, then commit or stash before pulling.
- `**pnpm run db:verify` fails unexpectedly.\*\* `db:verify` is not read-only: it re-runs migrations, regenerates generated artifacts, and diffs them. Run it on a clean feature branch after schema changes, then commit the regenerated artifacts alongside the migration.

## Quick reference

- Notes schema owner: `lib/db-items`
- Notes production app: `apps/notes-next` (Railway)
- Editor package (git subtree): `lib/atomic-editor` — edit in place; sync with `bash scripts/atomic-editor-sync.sh push|pull` (see above)
- Repo-wide pre-push gate: `pnpm run verify`

## Private phone access through Tailscale

Run `pnpm dev:tailscale --background` from the repository root.
Use `pnpm dev:tailscale:status` and `pnpm dev:tailscale:stop` to manage it.
The shared tool lives in `~/git/tailscale-dev`; this project's setup and address
are in [the local Tailscale guide](docs/operations/local-development-tailscale.md).
