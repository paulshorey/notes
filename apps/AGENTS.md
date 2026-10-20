# `apps`

- `notes-next` serves the Notes web UI and REST API.
- `@lib/db-notes` is the shared source of truth for database schema, app-facing Notes contracts, and server-side workflow logic (including embeddings).

## Relationship to `@lib/db-notes`

- Keep Postgres access in `@lib/db-notes`; do not duplicate SQL or schema assumptions inside app folders.
- Shared Notes request/response shapes live in `@lib/db-notes/contracts/notes-app.ts` and the generated `@lib/db-notes/generated/contracts/notes-app.json`.
- Shared Notes server workflows live in `@lib/db-notes/services/notes-app.ts`.

## App boundaries

- `notes-next`
  - Next.js web app — serves the UI and the REST API
  - Imports `@lib/db-notes` types and uses `@lib/db-notes/services/notes-app` in its API routes
  - All embedding logic (Jina AI calls, DB writes) goes through `@lib/db-notes`

## Change workflow

- If a Notes table or column change affects app behavior, update `@lib/db-notes` first.
- Keep migrations, generated DB artifacts, generated Notes app contract, and shared service logic in sync.
- The `notes-next` build fails if the generated Notes contract is out of date.

## Documentation

Keep this file and all AGENTS.md files up to date. If any info is outdated or wrong, update it.
