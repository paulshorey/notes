# Project: Notes

A pnpm/Turborepo workspace with a text-focused Next.js notes app. The item model
supports broader personal and team productivity; the current UI still requires text.

## Layout and contracts

- `apps/notes-next`: web UI and REST API, deployed to Railway.
- `lib/db-items`: item schema, migrations, generated contracts, and shared service logic.
- `lib/config`: shared tooling. `lib/atomic-editor`: editor fork tracked as a Git subtree.

An item belongs to one workspace, has a nullable description, and stores no exclusive
content-type discriminator. A note is an item with nonblank text. Use item terminology
in generic backend/state/API code; retain note wording in the text capture UI.
See [item boundaries](docs/db/item-core.md). Keep historical migrations immutable;
legacy views, session fields, backup formats, and `DB_NOTES_URL` remain compatibility protocols.
Categories are optional with no default/protected rows; `uncategorized` is display text.

## Editor and working conventions

Use pnpm from the root; never install dependencies inside build/dev/test/start scripts.
Use Zustand for app-wide UI state. Read nested `AGENTS.md`; new guides also need a
`CLAUDE.md` symlink. Edit the target only, since existing symlinks update automatically.

Edit `lib/atomic-editor` as a normal package; sync only on request through
`scripts/atomic-editor-sync.sh`, without `--squash`. Preserve its standalone
`package-lock.json` and `.github/`. Peer React/CodeMirror dependencies resolve from
`notes-next`; do not duplicate them. The app build builds the editor; for live edits
use `pnpm --filter @atomic-editor/editor exec tsc -w -p tsconfig.build.json`.
See [the subtree guide](docs/atomic-editor/git-subtree.md).

## Database, scripts, and releases

Real database scripts belong in `lib/db-items/package.json`; root scripts expose
human entrypoints, `db:*`, `verify:*`, and the multi-step `release:notes:prepare`.
Keep app scripts local; avoid duplicate migration scripts and trivial extra aliases.

For schema/contract changes, update `lib/db-items/scripts/verify-contract.mjs`, run
`pnpm run db:migrate` and `pnpm run db:verify`, and commit generated artifacts.
`db:migrate:baseline` is only for an existing legacy schema without a migration ledger.
Run `release:notes:prepare` before release; Railway pre-deploy applies tracked migrations.
Manual migration is for local/shared development or an intentional target preflight.

Follow [.railway/README.md](.railway/README.md): export only the `notes` partial in
WebArts, preserve variables/service names, and explicitly apply settings changes.
CI maps `main` to dev and `prod` to production; existing previews need their environment
ID and `RAILWAY_IAC_BRANCH`. Run `pnpm run diagnose:notes` for read-only, credential-safe
checks; [the environment matrix](docs/operations/notes-environments.md) owns diagnosis.

PRs into `main` require [the completion gate](docs/operations/pr-check-completion.md).
Only `PR checks finished` is required; failed checks remain visible for human judgment.
Never report aggregate success while checks are pending. New workflows must join its
`workflow_run` list; keep policy tests read-only and status writes on trusted code.
Publish one durable-head gate while inspecting head and test-merge checks. Developer-authorized
promotions may push `prod` directly; optional PRs get the same completion
status. Verify pre-deploy migrations and app health after promotion.

Write PR handoffs with the problem, resulting behavior, material decisions,
validation, and remaining work; scale detail to the change.

## Cloud environments

Cursor Cloud provides disposable PostgreSQL 17/pgvector databases through
`DB_ITEMS_URL` and `DB_ITEMS_TEST_URL`. Migrate empty databases before use;
Use `scripts/cloud-agent-postgres.sh` with `status`, `install`, or `start` to
diagnose or prepare them.

Other Debian/Ubuntu agents use `bash scripts/agent-env-setup.sh`, then
`source .agent-env.sh`. This installs tools/dependencies and creates/migrates local
throwaway databases. Never point agent VM database URLs at deployed Railway data.
`--dev` starts the app, `--verify` runs diagnosis; `JINA_API_KEY` is needed only for
semantic search. See [agent setup](docs/operations/agent-environment.md) for flags/ports.

# Research and report

If something goes wrong, stop the affected operation and report relevant findings, data, and logs.
Redact secrets and private content.
If unsure about something, research, search the web, find latest techniques and best practices.

# Next steps

Consider what was recently done, what's in progress, and how it contributes to the goal.
Decide and recommend what to do next.

# Goal: Unify notes, knowledge, tasks, and website content for individuals and teams
