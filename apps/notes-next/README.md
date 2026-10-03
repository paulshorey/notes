# Notes Web / API

`apps/notes-next` is the Railway-deployed Notes web app and REST API. It depends on `@lib/db-notes` for schema, runtime DB access, and generated Notes contracts.

## Environment variables

| Variable       | Required | Purpose                                                                                |
| -------------- | -------- | -------------------------------------------------------------------------------------- |
| `DB_NOTES_URL` | Yes      | PostgreSQL connection string for Notes                                                 |
| `JINA_API_KEY` | Yes      | Jina embeddings key for semantic search and maintenance                                |
| `PG_POOL_MAX`  | No       | Process-wide PostgreSQL connection limit; defaults to `1` for remote-proxy reliability |

Create `apps/notes-next/.env.local` or export the values in your shell:

```bash
DB_NOTES_URL=postgres://...
JINA_API_KEY=jina_...
```

## Local workflow

```bash
pnpm run deps:install -- notes-next...
pnpm run db:migrate
pnpm --filter notes-next dev
```

The app runs at `http://localhost:5500`.

For a read-only check of the current checkout, app health, database target, and
migration ledger, run `pnpm run diagnose:notes` from the repository root. The
full environment matrix and Railway troubleshooting flow are in
[`docs/operations/notes-environments.md`](../../docs/operations/notes-environments.md).

On startup, returning sessions are seeded by the server and the UI loads the user's workspace list plus one active workspace's notes, categories, statuses, and tags through `GET /api/bootstrap`. A database or network failure shows a retryable error instead of repeatedly issuing requests. The service worker is disabled and cleaned up on local hosts so old app shells or development chunks cannot survive a server restart.

## Relevant scripts

```bash
pnpm run verify:notes-web
pnpm --filter notes-next build
pnpm --filter notes-next test
pnpm --filter notes-next check-types
pnpm --filter notes-next verify
```

This package only validates the Notes contract. It does not own migration scripts; those stay in `lib/db-notes`.

## API routes

| Method                | Path                                | Purpose                                       |
| --------------------- | ----------------------------------- | --------------------------------------------- |
| GET                   | `/api/bootstrap`                    | Load workspaces and the active workspace      |
| GET/PATCH             | `/api/session`                      | Read session or update preferences            |
| GET/POST              | `/api/backup`                       | Download backup or merge a backup into account |
| GET/POST/PATCH/DELETE | `/api/notes`                        | List, create, update, delete notes            |
| GET/POST/PATCH/DELETE | `/api/categories`                   | Manage workspace categories                   |
| GET/POST/PATCH/DELETE | `/api/statuses`                     | Manage workspace statuses                     |
| GET/POST/PATCH/DELETE | `/api/tags`                         | Manage workspace tags                         |
| GET/POST/PATCH/DELETE | `/api/workspaces`                   | Manage user workspaces                        |
| POST                  | `/api/notes/search`                 | Semantic search                               |
| POST                  | `/api/notes/maintenance/embeddings` | Backfill or repair stale embeddings           |
| GET                   | `/api/health`                       | Railway liveness probe                        |

## Backup and restore

Open the account menu and choose **Download backup** to save a versioned JSON
file containing all workspaces, notes, categories, statuses, tags, relationships,
dates, and preferences. The app saves pending notes and preferences first. Visitors
can download a backup; restore requires signing in or creating an account.

Choose **Restore backup…**, select the file, review its workspace and note counts,
then choose **Merge backup into this account**. Existing notes remain intact.
Workspaces and vocabulary with matching labels are combined; destination status
positions are kept on collisions. Backup settings replace matching settings,
while account-only settings survive. Changed versions of a note are kept alongside
the existing version. Repeating an import skips exact copies, including the
correct number of intentionally identical notes. The current editor stays open.

Files are limited to 50 MiB and 100,000 records (workspaces, vocabulary, and notes
combined). Passwords, login tokens, account identity/contact information, and
generated search vectors are excluded. Store files securely: note text is plain
JSON. After restoring, choose **Repair missing embeddings** in the account menu
to include imported notes in semantic search; repeat if the result reports more
remaining. Backup and restore themselves do not require a Jina API key.

The complete file is validated before writes. Restore stages a temporary source
and uses the same merge core as anonymous sign-in within one database transaction;
a failure rolls back the whole import. The server always obtains the destination
user from the cookie or bearer token, never from the backup. Format and API details
are documented in [`notes-api.md`](../../lib/db-notes/contracts/notes-api.md).

## Production release notes

When promoting Notes to production:

1. Run repo-level preflight from the root:

   ```bash
   pnpm run release:notes:prepare
   ```

2. Deploy `apps/notes-next` on Railway. Railway runs the package-owned migration command before activating the release:

   ```bash
   pnpm --filter @lib/db-notes db:migrate
   ```

   A failed migration blocks deployment, and the health endpoint rejects a connected but outdated database. Run `pnpm run db:migrate` manually only for local/shared development or an intentional target-database preflight.

3. If search data is stale after the deploy, run `pnpm run db:embeddings:regenerate` or call the maintenance endpoint:

   ```text
   POST /api/notes/maintenance/embeddings
   Body: { "userId": <id>, "mode": "stale", "limit": 100 }
   ```

Use `pnpm run db:verify` deliberately. It is not read-only and is usually best on a clean branch before merge rather than as part of every production push.
