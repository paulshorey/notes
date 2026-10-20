# `apps`

- `notes-next` serves the Notes web UI and REST API.
- `@lib/db-items` is the shared source of truth for database schema, app-facing item contracts, and server-side workflow logic (including embeddings).

## Relationship to `@lib/db-items`

- Keep Postgres access in `@lib/db-items`; do not duplicate SQL or schema assumptions inside app folders.
- Shared item request/response shapes live in `@lib/db-items/contracts/items-app.ts` and the generated `@lib/db-items/generated/contracts/items-app.json`.
- Shared item server workflows live in `@lib/db-items/services/items-app.ts`.

## App boundaries

- `notes-next`
  - Next.js web app — serves the UI and the REST API
  - Imports `@lib/db-items` types and uses `@lib/db-items/services/items-app` in its API routes
  - All embedding logic (Jina AI calls, DB writes) goes through `@lib/db-items`

## Change workflow

- If an item table or column change affects app behavior, update `@lib/db-items` first.
- Keep migrations, generated DB artifacts, generated item app contract, and shared service logic in sync.
- The `notes-next` build fails if the generated item contract is out of date.

## Documentation

Keep this file and all AGENTS.md files up to date. If any info is outdated or wrong, update it.
