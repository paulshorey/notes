# Notes Web / API

`apps/notes-next` is the Railway-deployed Notes web app and REST API. It depends on `@lib/db-marketing` for schema, runtime DB access, and generated Notes contracts.

## Environment variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `MARKETING_DB_URL` | Yes | PostgreSQL connection string for Notes |
| `JINA_API_KEY` | Yes | Jina embeddings key for semantic search and maintenance |

Create `apps/notes-next/.env.local` or export the values in your shell:

```bash
MARKETING_DB_URL=postgres://...
JINA_API_KEY=jina_...
```

## Local workflow

```bash
pnpm run deps:install -- notes-next...
pnpm run db:migrate
pnpm --filter notes-next dev
```

The app runs at `http://localhost:3000`.

## Relevant scripts

```bash
pnpm run verify:notes-web
pnpm --filter notes-next build
pnpm --filter notes-next test
pnpm --filter notes-next check-types
pnpm --filter notes-next verify
```

This package only validates the Notes contract. It does not own migration scripts; those stay in `lib/db-marketing`.

## API routes

| Method | Path | Purpose |
|--------|------|---------|
| GET/POST | `/api/session` | Look up user by userId or login by identifier |
| GET/POST/PATCH/DELETE | `/api/notes` | List, create, update, delete notes |
| GET/POST | `/api/tags` | List, create tags |
| POST | `/api/notes/search` | Semantic search |
| POST | `/api/notes/maintenance/embeddings` | Backfill or repair stale embeddings |
| GET | `/api/health` | Railway liveness probe |

## Production release notes

When promoting Notes to production:

1. Run repo-level preflight from the root:

   ```bash
   pnpm run release:notes:prepare
   ```

2. Run Notes DB migrations through `lib/db-marketing`:

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
