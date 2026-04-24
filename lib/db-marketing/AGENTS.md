# `@lib/db-marketing`

- This package is internal to this monorepo and is consumed directly from TypeScript source.
- Use extensionless relative imports in `.ts` files. Do not add `.js` suffixes unless the package starts emitting build artifacts.
- Keep database helpers here only when they are reused across apps in this repo.

Database-first package for the `MARKETING_DB_URL` database.

## Source of truth

- `migrations/`: canonical schema change history
- `schema/current.sql`: generated snapshot of expected schema
- `queries/`: language-agnostic SQL query contracts
- `contracts/notes-app.ts`: canonical app-facing Notes contract
- `generated/contracts/notes-app.json`: generated Notes contract artifact

## TypeScript adapter

- `lib/db/postgres.ts`: connection accessor for app/runtime code
- `services/notes-app.ts`: shared Notes app workflow layer for web and Android servers

## Notes

- Keep SQL and migration contracts database-first; generated bindings are
  derived artifacts.
- This package is the canonical home for Notes migration scripts. Root
  `package.json` may proxy into these commands, but app packages should not
  duplicate them.
- `user_v1.phone` is stored as `text`, not a numeric type. Treat phone numbers
  as identifiers and normalize digits at query boundaries when needed.
- `user_v1` and `user_note_v1` share the `apply_row_timestamps_v1()` trigger
  function so `time_modified` refreshes automatically on insert/update while
  `time_created` stays stable after insert.
- Fresh empty DB: run `pnpm --filter @lib/db-marketing db:migrate`, then
  `db:verify`.
- Existing pre-migration DB with baseline schema already present: run
  `db:migrate:baseline` once, then `db:migrate`, then `db:verify`.
- `db:migrate:baseline` is a legacy recovery tool, not a standard release step.
- `db:verify` is not read-only; it runs `db:migrate` first.
- Only run `db:migrate` / `db:verify` against a deployed remote DB when the
  user explicitly requests it. Check connectivity and pending migrations first.
- Never manually create or alter tables outside migrations.
- Migration files are forward-only SQL; do not add `BEGIN` / `COMMIT`.
- For populated tables, migrations must explicitly backfill data and explicitly
  convert types with `USING` where needed.
- After schema changes, keep `migrations/`, `schema/current.sql`, generated
  artifacts, app contracts, and query contracts in sync.
- **`scripts/verify-contract.mjs` must be updated alongside every migration.**
  When adding columns/indexes/constraints, add corresponding assertions. When
  dropping columns/indexes/constraints, replace "must exist" assertions with
  "must be absent" assertions. Failure to update this script is the most common
  cause of `db:verify` failures after merging.
- Always run `db:verify` on the feature branch before merging to confirm the
  migration, verify script, and generated artifacts are all consistent.
- For Notes production rollout, the normal order is: verify code, run
  `db:migrate` against the target Notes DB, deploy `notes-next`, then run
  embedding regeneration only when search data is stale.

## Embeddings (semantic search)

Provider: **Jina AI** — Model: `jina-embeddings-v5-text-small` (1024 dims, normalized).

### Key files

- `services/notes-embeddings.ts` — canonical Jina client, embedding constants, and text builders
- `services/notes-app.ts` — orchestrates embed-on-write (notes + tags) and search
- `sql/note/gets.ts` — `searchNotesByEmbedding` SQL: composite score = `description * 0.67 + avg_tag * 0.33`
- `scripts/regenerate-embeddings.mjs` — CLI bulk regeneration (must stay in sync with `notes-embeddings.ts`)

### How it works

- **Storing** descriptions/tags: Jina API with `task: "retrieval.passage"` → `vector(1024)` in PostgreSQL (HNSW cosine index).
- **Searching**: user query embedded with `task: "retrieval.query"` → cosine similarity in SQL.
- **No text prefix** is added to inputs. Jina v5's `task` parameter selects the asymmetric LoRA adapter internally — manual `Query:`/`Document:` prefixes are unnecessary and harmful when using the API.

### Debug page

`apps/notes-next/app/embeddings/page.tsx` → `POST /api/embeddings/debug` — standalone Jina calls with the same scoring formula. Separate **Search task** and **Passage task** selects map to the Jina `task` field (defaults: `retrieval.query` / `retrieval.passage`, matching production); you can pick `(none)` to omit `task` and compare behavior.

### Environment

Requires `JINA_API_KEY`. Missing key → `EmbeddingConfigurationError` (500).
