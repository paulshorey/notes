# Notes Web / API

`apps/notes-next` is the Railway-deployed Notes web app and REST API. It depends on `@lib/db-notes` for schema, runtime DB access, and generated Notes contracts.

## Environment variables

| Variable       | Required | Purpose                                                 |
| -------------- | -------- | ------------------------------------------------------- |
| `DB_NOTES_URL` | Yes      | PostgreSQL connection string for Notes                  |
| `JINA_API_KEY` | Yes      | Jina embeddings key for semantic search and maintenance |

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

The app runs at `http://localhost:3000`.

On startup, returning sessions are seeded by the server and the UI loads its initial session, notes, taxonomy, and tags through `GET /api/bootstrap`. A database or network failure shows a retryable error instead of repeatedly issuing requests. The service worker is disabled and cleaned up on local hosts so old app shells or development chunks cannot survive a server restart.

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
| GET                   | `/api/bootstrap`                    | Load authenticated web startup data           |
| GET/POST              | `/api/session`                      | Look up user by userId or login by identifier |
| GET/POST/PATCH/DELETE | `/api/notes`                        | List, create, update, delete notes            |
| GET/POST              | `/api/tags`                         | List, create tags                             |
| POST                  | `/api/notes/search`                 | Semantic search                               |
| POST                  | `/api/notes/maintenance/embeddings` | Backfill or repair stale embeddings           |
| GET                   | `/api/health`                       | Railway liveness probe                        |

## Production release notes

When promoting Notes to production:

1. Run repo-level preflight from the root:

   ```bash
   pnpm run release:notes:prepare
   ```

2. Run Notes DB migrations through `lib/db-notes`:

   ```bash
   pnpm run db:migrate
   ```

3. Deploy `apps/notes-next` on Railway.
4. If search data is stale after the deploy, run `pnpm run db:embeddings:regenerate` or call the maintenance endpoint:

   ```text
   POST /api/notes/maintenance/embeddings
   Body: { "userId": <id>, "mode": "stale", "limit": 100 }
   ```

Use `pnpm run db:verify` deliberately. It is not read-only and is usually best on a clean branch before merge rather than as part of every production push.
