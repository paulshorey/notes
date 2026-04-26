# Marketing Monorepo

Monorepo for two release targets:

- `apps/notes-next` - Notes web app and REST API, deployed to Railway
- `apps/notes-android` - Android client, released as an APK artifact in the PR

`lib/db-marketing` is the source of truth for the Notes database schema, generated contracts, and shared Notes server workflows.

## Script ownership

All day-to-day developer workflows run from the repo root. Each command is a thin wrapper around the real work in the appropriate package, so you do not have to remember `pnpm --filter <pkg> ...` invocations.

### Install and verify

| Command | What it does |
|---------|--------------|
| `pnpm run deps:install` | Install all workspace dependencies (Turbo / pnpm). |
| `pnpm run verify` | Repo-wide pre-push gate. Runs `verify:db-contracts` then every app's `verify`. |
| `pnpm run verify:db-contracts` | Type-check `lib/db-marketing` and confirm generated Notes contract artifacts are up to date. |
| `pnpm run verify:notes-web` | `notes-next`: type-check, tests, and production build. |
| `pnpm run verify:android` | `notes-android`: contract validation plus debug APK assembly. |
| `pnpm run verify:apps` | Run `verify:notes-web` and `verify:android` back to back. |

### Build

| Command | What it does |
|---------|--------------|
| `pnpm run build` | Turbo `build` across every package. |
| `pnpm run build:notes-web` | Production build of `apps/notes-next`. |
| `pnpm run build:android` | Contract validation plus debug APK assembly. |
| `pnpm run build:android:dist:dev` | Produce `apps/notes-android/dist/notes-android.apk` pointed at the **dev** `notes-next` (`https://marketing-apps-notes-next-dev.up.railway.app`). |
| `pnpm run build:android:dist:prod` | Produce `apps/notes-android/dist/notes-android.apk` pointed at the **production** `notes-next` (`https://marketing-apps-notes-next.up.railway.app`). |

### Database (`lib/db-marketing`)

| Command | What it does |
|---------|--------------|
| `pnpm run db:migrate` | Bring the Notes database at `MARKETING_DB_URL` up to the latest tracked schema. |
| `pnpm run db:migrate:baseline` | Legacy recovery tool: mark baseline migrations as applied for a legacy Notes DB that already has the baseline schema but has never been tracked. Not part of normal release flow. |
| `pnpm run db:verify` | Re-run migrations then regenerate and diff contract artifacts against the live DB. Not read-only. |
| `pnpm run db:embeddings:regenerate` | Rebuild stale Notes embeddings. Only needed when search data drifts or embedding format changes. |

The real scripts live in `lib/db-marketing/package.json`. App packages do not own migration scripts.

### Release preparation

| Command | What it does |
|---------|--------------|
| `pnpm run release:notes:prepare` | `verify:db-contracts` + `verify:notes-web`. Run before a `notes-next` Railway deploy. |

For Android, run `pnpm run build:android:dist:dev` or `pnpm run build:android:dist:prod` — they produce the canonical APK pointed at the explicit target environment.

## Apps and deploy targets

| Path | Deploy target | Depends on `lib/db-marketing` |
|------|---------------|-------------------------------|
| `apps/notes-next` | Railway | Yes |
| `apps/notes-android` | APK artifact only | Contract validation only |

## Environment variables

| Variable | Used by | Purpose |
|----------|---------|---------|
| `MARKETING_DB_URL` | `lib/db-marketing`, `apps/notes-next` | PostgreSQL connection string for Notes. Set in your shell when running `db:*` commands or `notes-next` locally; set in the Railway service for production. |
| `JINA_API_KEY` | `lib/db-marketing`, `apps/notes-next` | Jina embeddings key for semantic search and embedding maintenance. |
| `NOTES_ANDROID_API_BASE_URL` | `apps/notes-android` | Override the `notes-next` base URL baked into the APK at build time. |

> **Heads up.** `MARKETING_DB_URL` and `JINA_API_KEY` are *server* variables. They do not affect the Android APK. Which Notes database an APK ultimately reaches is determined by which `notes-next` deployment the APK calls, which is set by `NOTES_ANDROID_API_BASE_URL` at build time. See the Android release section below.

## Development setup

### Prerequisites

- Node.js 20+
- pnpm 10.x
- PostgreSQL 17 client tools (`psql`, `pg_dump`) for `db:verify` and schema snapshots
- Android Studio / Android SDK only if you are building the Android app

### Install dependencies

```bash
pnpm run deps:install
```

Focused installs are still available:

```bash
pnpm run deps:install -- notes-next...
pnpm run deps:install -- notes-android...
```

### Local app entry points

```bash
pnpm --filter notes-next dev         # http://localhost:3000
pnpm --filter notes-android build    # contract validation + debug APK
```

`notes-next` needs `MARKETING_DB_URL` and `JINA_API_KEY` in its shell (or `apps/notes-next/.env.local`). The Android build does not.

See the app README files for package-specific setup:

- [`apps/notes-next/README.md`](apps/notes-next/README.md)
- [`apps/notes-android/README.md`](apps/notes-android/README.md)
- [`lib/db-marketing/README.md`](lib/db-marketing/README.md)

## Daily development loop

A normal feature cycle looks like this:

```bash
pnpm run deps:install                # once per checkout, and after dependency changes
pnpm --filter <pkg> dev              # iterate on the relevant app

# before opening or updating a PR
pnpm run verify                      # repo-wide gate
```

If you changed the Notes schema or any `lib/db-marketing` contract:

```bash
export MARKETING_DB_URL=postgres://.../<your dev db>
pnpm run db:migrate                  # apply your new migration
pnpm run db:verify                   # regenerate and diff contract artifacts
git add lib/db-marketing/generated   # commit regenerated artifacts with the migration
```

## Migrations

All Notes DB migrations live in `lib/db-marketing`.

Run migrations in these cases:

- Run `pnpm run db:migrate` when the target Notes database should be brought up to the latest tracked schema.
- Run `pnpm run db:verify` on a clean feature branch after schema changes, before merge, to confirm the migration files, generated artifacts, and structural assertions still match.
- Run `pnpm run db:migrate:baseline` only once for a legacy Notes database that already has the baseline schema but has never been placed under migration tracking.
- Run `pnpm run db:embeddings:regenerate` only when Notes search data is stale or the embedding/text format changed.

Do not put Notes migration scripts in `apps/notes-next` or `apps/notes-android`. Those apps consume the DB contract; they do not own it.

## Production release order

If production is stale and you want to promote the newest repo state, use the flow below.

### 1. Common preflight

```bash
pnpm run deps:install
pnpm run verify
```

`pnpm run verify` is the repo-wide pre-push/pre-release gate. It verifies the DB contract package, `notes-next`, and `notes-android` with package-specific checks.

### 2. Notes web / API (`apps/notes-next`)

Use this when Notes code, schema, or search maintenance changed.

For the code-only preparation step, you can run:

```bash
pnpm run release:notes:prepare
```

1. Point `MARKETING_DB_URL` at the target Notes database.
2. If the target DB is already tracked by migrations, run:

   ```bash
   pnpm run db:migrate
   ```

3. If the target DB is a legacy untracked database with the baseline schema already present, run this once instead:

   ```bash
   pnpm run db:migrate:baseline
   pnpm run db:migrate
   ```

4. Deploy `apps/notes-next` on Railway. Railway build/start behavior is defined in `apps/notes-next/railway.json`.
5. If Notes embeddings are stale after the deploy, run one of these maintenance paths:

   ```bash
   pnpm run db:embeddings:regenerate
   ```

   Or call:

   ```text
   POST /api/notes/maintenance/embeddings
   ```

6. Use `pnpm run db:verify` when you explicitly want to validate contract reproducibility against the target DB. It is not read-only and rewrites local generated files, so it is usually better before merge than during every production push.

### 3. Android (`apps/notes-android`)

Use this when Android code changed or when the APK should target a different `notes-next` base URL.

The Android release is **not a Railway deploy**. The deliverable is a canonical APK at `apps/notes-android/dist/notes-android.apk` that gets attached to or linked from the PR.

#### Pick the backend the APK talks to

The APK never reads `MARKETING_DB_URL`. Exporting it in your shell has no effect on the build. What matters is which `notes-next` deployment the APK calls, which is controlled by `NOTES_ANDROID_API_BASE_URL` at build time:

- Production `notes-next`: `https://marketing-apps-notes-next.up.railway.app`
- Dev `notes-next`: `https://marketing-apps-notes-next-dev.up.railway.app`

Use the explicit scripts so there is no ambiguity:

```bash
pnpm run build:android:dist:prod   # APK pointed at the prod notes-next
pnpm run build:android:dist:dev    # APK pointed at the dev notes-next
```

Both commands write `apps/notes-android/dist/notes-android.apk`. During Gradle configuration the build logs `notes-android: API base URL = <url>` so you can confirm which backend was baked in before installing.

To target a custom URL (e.g. a staging or local `notes-next`), pass `NOTES_ANDROID_API_BASE_URL` inline:

```bash
NOTES_ANDROID_API_BASE_URL="https://staging.example/" pnpm --filter notes-android build:dist:dev
```

The inline assignment overrides the URL embedded in `build:dist:dev`. Use whichever named script is closest to your target and override only the URL.

> **Gotcha:** Gradle resolves `NOTES_ANDROID_API_BASE_URL` in this order: `apps/notes-android/local.properties`, `-P` Gradle property, shell environment, script-level inline assignment. If a rebuild does not change which backend the APK hits, check for a stale `NOTES_ANDROID_API_BASE_URL=...` line in `apps/notes-android/local.properties` and remove it. That file should normally only contain `sdk.dir`.

#### Install the APK on a device

The repo ships a committed debug keystore so you can upgrade between builds (dev-pointing and prod-pointing) in place, without uninstalling first:

```bash
adb install -r apps/notes-android/dist/notes-android.apk
```

For a phone-side sideload, copy the APK to the device, then open the file and accept the install.

## Troubleshooting

- **"I set `MARKETING_DB_URL` to prod and rebuilt the APK, but it still hits dev."** `MARKETING_DB_URL` is a `notes-next` server variable. It does not affect the APK. Run `pnpm run build:android:dist:prod` to build an APK that calls the production `notes-next`.
- **`pnpm run build:android:dist:prod` appears to succeed but the APK still hits dev.** Check `apps/notes-android/local.properties` for a stale `NOTES_ANDROID_API_BASE_URL=...` line; `local.properties` wins over the shell. The Gradle configuration log line (`notes-android: API base URL = ...`) shows the value actually baked into the APK.
- **`pnpm run db:verify` fails unexpectedly.** `db:verify` is not read-only: it re-runs migrations, regenerates generated artifacts, and diffs them. Run it on a clean feature branch after schema changes, then commit the regenerated artifacts alongside the migration.
- **Android build cannot find the SDK.** Either install Android Studio and export `ANDROID_HOME`, or run `bash apps/notes-android/tools/setup-android-sdk.sh`, which provisions a repo-local SDK under `.android-sdk` and falls back there automatically if `ANDROID_HOME` points at an unwritable path.

## Quick reference

- Notes schema owner: `lib/db-marketing`
- Notes production app: `apps/notes-next` (Railway)
- Android release artifact: `apps/notes-android/dist/notes-android.apk` (built via `build:android:dist:{dev,prod}`)
- Repo-wide pre-push gate: `pnpm run verify`
