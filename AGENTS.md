# Workspace

Monorepo using pnpm + Turborepo.

## Products

### Apps

- `apps/notes-next` - Notes web UI and REST API, deployed to Railway
- `apps/notes-android` - native Android client; release is an APK artifact, not a hosted service

### Libraries

- `lib/config` - shared tooling and config
- `lib/db-notes` - Notes database schema, migrations, generated contracts, and shared Notes service logic
- `lib/atomic-editor` - fork of `@atomic-editor/editor`, tracked as a git subtree (see below)

## atomic-editor package (git subtree)

`lib/atomic-editor` is a fork of `kenforthewin/atomic-editor`. It is committed directly to this monorepo as regular files (NOT a git submodule) and linked to the standalone fork `paulshorey/atomic-editor` via **git subtree**. `notes-next` consumes it via `workspace:*`.

**Full subtree guide:** `docs/atomic-editor/git-subtree.md` (sync commands, what changes in each repo, upstream PR implications).

- Build output lives in `lib/atomic-editor/dist/` (gitignored). `notes-next build` builds the editor first.
- Peer deps (`@codemirror/*`, `react`) resolve from `notes-next` — do not add duplicate copies in this package.
- Local dev: run `pnpm --filter @atomic-editor/editor exec tsc -w -p tsconfig.build.json` while editing `src/`, then `pnpm --filter notes-next dev`.
- `lib/atomic-editor/package-lock.json` and `lib/atomic-editor/.github/` belong to the standalone fork repo; keep them intact for subtree syncs, but pnpm (not npm) manages deps inside this monorepo.
- Day-to-day: edit `lib/atomic-editor/` like any package; no sync required.
- Sync to/from fork (on demand only): `bash scripts/atomic-editor-sync.sh push <fork-branch>` / `pull [<fork-branch>]`. Do not use `--squash`.

## Data

- `@lib/db-notes` owns all Notes schema changes and migration scripts.
- `notes-next` consumes `@lib/db-notes` at runtime.
- `notes-android` validates against the generated Notes app contract but does not touch Postgres directly.

## Context

This codebase is developed by AI agents.

- AGENTS.md - documentation for standard AI agents - source of truth - describes each folder structure and gotchas
- CLAUDE.md - not a real file, only a symlink. When adding a new AGENTS.md file, also add a symlink to it called CLAUDE.md, so the non-standard Claude Code AI can read it also. When editing an AGENTS.md file, do not both changing CLAUDE.md, it will be automatically updated because it's only a symlink.

## Script ownership

- Root `package.json` should expose the human-friendly entry points for install, verify, app builds, APK generation, and proxied `db:*` commands.
- Root `package.json` should also expose `release:notes:prepare` (a meaningful multi-step aggregation) and `verify:*` aliases so the documented release order maps to actual commands. Avoid adding single-command aliases that just wrap one other script.
- `lib/db-notes/package.json` is the canonical home for real migration and contract-generation scripts.
- App `package.json` files should stay focused on app-local build, run, and verification commands.
- Do not define duplicate migration scripts inside app packages.

## Working conventions

- Use `pnpm` only.
- Keep the repo root as the default working directory.
- Prefer root-scoped commands such as `pnpm run db:migrate` or `pnpm --filter <pkg> ...`.
- In `apps/notes-next`, use Zustand stores for app-wide UI state instead of prop-drilling state through multiple components.
- For Android Gradle, prefer `bash apps/notes-android/gradlew --no-daemon -p apps/notes-android <task>`.
- Do not add package-local install steps to build, dev, test, or start scripts.

## Release model

- `notes-next`: run `release:notes:prepare`, run Notes DB migration steps when needed, then deploy on Railway.
- `notes-android`: run `build:android:dist:dev` or `build:android:dist:prod`, then share the APK download link in the PR; no Railway deploy.

## Database rules

After changing Notes schema or contracts in `lib/db-notes`:

1. Update `lib/db-notes/scripts/verify-contract.mjs`.
2. Run `pnpm run db:migrate`.
3. Run `pnpm run db:verify`.
4. Commit generated artifacts with the schema change.

Use `pnpm run db:migrate:baseline` only for a legacy Notes database that already contains the baseline schema but has never been tracked by migrations.

## Android conventions

- All Android tooling lives in `apps/notes-android/tools/`.
- Repo-local Android tool paths include `.jdk/current`, `.android-sdk`, `.android-user-home`, and `.gradle`.
- `apps/notes-android/local.properties` is machine-local; do not rely on it for committed behavior.
- `pnpm run build:android:dist:dev` and `build:android:dist:prod` produce `apps/notes-android/dist/notes-android.apk` pointed at the respective `notes-next` deployment. There is no ambiguous bare `build:android:dist` — the target environment must be specified.

## Documentation

- Read the closest `AGENTS.md` before editing a folder.
- Keep `AGENTS.md` concise and aligned with the real code and deployment model.
- Remove stale instructions when structure or release flow changes.
- `AGENTS.md` is for agents; `README.md` is for humans.

## Pull requests

- After completing a feature request, create or update the PR and include the PR link in the final response.
- The PR description serves as a handoff to the next AI agent or engineer. Always write a comprehensive PR description that includes the full details of what was done and why. Include:
  - A summary of the change and its motivation.
  - Every file added or modified, with a brief explanation of what each file does.
  - Key technical decisions (e.g. which approach was chosen and why).
  - Any testing that was performed and the results.
  - Handoff notes: anything the next person needs to know to continue, deploy, or review the work.
- Do not write a minimal or abbreviated PR description. The PR description should contain all the information from the conversation that explains the code changes, so someone reading only the PR can fully understand the work without needing the original conversation.

## Cursor Cloud specific instructions

The `MARKETING_DB_URL` secret injected into cloud VMs points at a **remote Railway
Postgres**, not a local database. Do not run `db:migrate` / `db:verify` (or the
note-writing UI) against it — per the db rules, remote migrations require an
explicit request. For local development, run against a **local** Postgres and
override `MARKETING_DB_URL` in the shell.

Local Postgres is provisioned automatically:

- `scripts/cloud-agent-install.sh` installs the PostgreSQL 17 server + `pgvector`
  (migrations use `vector(1024)` HNSW indexes).
- `scripts/cloud-agent-start.sh` starts the `17 main` cluster (port 5432) and
  creates the `notes` role plus the `notes` (dev) and `notes_test` (test)
  databases. All steps are idempotent.
- `DB_MARKETING_TEST_URL` is preset (in `.cursor/environment.json`) to
  `postgresql://notes:notes@localhost:5432/notes_test` for `@lib/db-marketing`
  tests.

So per session you only need to point `notes-next` at a local DB and run it:

```bash
export PATH="/usr/lib/postgresql/17/bin:$PATH"
# override the remote secret for this shell (local dev only)
export MARKETING_DB_URL="postgresql://notes:notes@localhost:5432/notes"  # pragma: allowlist secret
export AUTH_SECRET="$(openssl rand -base64 32)" AUTH_TRUST_HOST=true
pnpm run db:migrate                       # migrates the local 'notes' db
pnpm --filter notes-next dev              # http://localhost:3000
```

To migrate the test database instead, point `db:migrate` at `notes_test`:
`MARKETING_DB_URL="$DB_MARKETING_TEST_URL" pnpm run db:migrate`.

Non-obvious gotchas:

- Next.js does not override an **already-exported** `MARKETING_DB_URL` with values
  in `apps/notes-next/.env.local`, so the local URL must be exported in the same
  shell that runs `db:migrate` and `dev` (as above). `.env.local` is only used for
  vars not already in the environment (e.g. `AUTH_SECRET`).
- If a cluster is not yet running (e.g. the start hook was skipped), bring it up
  with `sudo pg_ctlcluster 17 main start` before any `db:*` command.
- A new visitor gets an anonymous user automatically, but a note only **autosaves**
  once a **category is selected** and the body is non-empty (there is no save
  button; autosave fires ~3s after typing). Anonymous users start with no
  categories, so create/select one first or the save is silently skipped.
- If the Next.js dev server is restarted while a browser tab is open, stale chunk
  hashes make the page hang on "Loading…". Hard-reload the tab (Ctrl+Shift+R).
- Health check: `GET http://localhost:3000/api/health` returns
  `{"database":"connected"}` when the DB wiring is correct.

## Maintenance

Keep this file up to date after major workspace-level changes. Edit it when app boundaries, release workflows, script ownership, or shared contracts change.
