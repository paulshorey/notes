# Workspace

Monorepo using pnpm + Turborepo.

## Products

### Apps

- `apps/notes-next` - Notes web UI and REST API, deployed to Railway
- `apps/notes-android` - native Android client; release is an APK artifact, not a hosted service

### Libraries

- `lib/config` - shared tooling and config
- `lib/db-marketing` - Notes database schema, migrations, generated contracts, and shared Notes service logic

## Data

- `@lib/db-marketing` owns all Notes schema changes and migration scripts.
- `notes-next` consumes `@lib/db-marketing` at runtime.
- `notes-android` validates against the generated Notes app contract but does not touch Postgres directly.

## Context

This codebase is developed by AI agents. 
- AGENTS.md - documentation for standard AI agents - source of truth - describes each folder structure and gotchas
- CLAUDE.md - not a real file, only a symlink. When adding a new AGENTS.md file, also add a symlink to it called CLAUDE.md, so the non-standard Claude Code AI can read it also. When editing an AGENTS.md file, do not both changing CLAUDE.md, it will be automatically updated because it's only a symlink.

## Script ownership

- Root `package.json` should expose the human-friendly entry points for install, verify, app builds, APK generation, and proxied `db:*` commands.
- Root `package.json` should also expose `release:notes:prepare` (a meaningful multi-step aggregation) and `verify:*` aliases so the documented release order maps to actual commands. Avoid adding single-command aliases that just wrap one other script.
- `lib/db-marketing/package.json` is the canonical home for real migration and contract-generation scripts.
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

After changing Notes schema or contracts in `lib/db-marketing`:

1. Update `lib/db-marketing/scripts/verify-contract.mjs`.
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

## Maintenance

Keep this file up to date after major workspace-level changes. Edit it when app boundaries, release workflows, script ownership, or shared contracts change.
