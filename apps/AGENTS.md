# `apps`

- `notes-next` and `notes-android` are sibling clients for the same Notes product domain.
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

- `notes-android`
  - Native Kotlin client (Jetpack Compose, Glance widget); calls `notes-next` as its API backend; does NOT talk to Postgres directly
  - Android build validates Kotlin models and JSON codec against the generated Notes contract from `@lib/db-notes` via `tools/validate-notes-contract.mjs`
  - App-specific tooling and agent guidance: `apps/notes-android/AGENTS.md`

## Change workflow

- If a Notes table or column change affects app behavior, update `@lib/db-notes` first.
- Keep migrations, generated DB artifacts, generated Notes app contract, and shared service logic in sync.
- Both `notes-next` and `notes-android` builds will fail if the shared contract becomes incompatible with either app.

## Documentation

Keep this file and all AGENTS.md files up to date. If any info is outdated or wrong, update it.
