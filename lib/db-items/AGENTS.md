# `@lib/db-items`

- This package is internal to this monorepo and is consumed directly from TypeScript source.
- Use extensionless relative imports in `.ts` files. Do not add `.js` suffixes unless the package starts emitting build artifacts.
- Keep database helpers here only when they are reused across apps in this repo.

Database-first package for the `DB_ITEMS_URL` database (`DB_NOTES_URL` is a rollout fallback).
See `docs/db/item-core.md` for the item domain and compatibility boundaries.

## Workspace ownership model

- `user_v1` owns `user_workspace_v1`; items and all item vocabulary are owned through a workspace.
- Every item has one `workspace_id`, zero or more category links, one nullable `status_id`, and zero or more tag links.
- Categories, statuses, and tags are independent flat vocabularies, unique by normalized label within a workspace. They are not a hierarchy.
- Categories have no seeded default or protected row. `uncategorized` is a reserved, display-only label for zero category links. Use `contracts/category-name.ts` for category create/rename validation; backup parsing converts the legacy literal category after validating references. See `docs/operations/category-cleanup.md` for the ordered rollout.
- Composite foreign keys enforce that every item relation comes from the item's own workspace.

## Source of truth

- `migrations/`: canonical schema change history
- `schema/current.sql`: generated snapshot of expected schema
- `queries/`: language-agnostic SQL query contracts
- `contracts/items-app.ts`: canonical app-facing item contract
- `generated/contracts/items-app.json`: generated item contract artifact

## TypeScript adapter

- `lib/db/postgres.ts`: process-wide connection pool for app/runtime code. It defaults to one connection so cold, parallel Next.js requests do not burst connections through a remote proxy; set `PG_POOL_MAX` explicitly when a deployment needs more concurrency.
- `services/items-app.ts`: Item workflow layer used by the web app's API routes
- `contracts/user-backup.ts`: versioned portable-backup validation and size limits;
  safe to import in the browser.
- `sql/user/backup.ts`: snapshot export and atomic staged restore. Restore calls
  `mergeAnonymousUserIntoWithClient` on the same client/transaction; do not use
  the pool-acquiring merge wrapper inside a transaction (pool defaults to one).

## Notes

- Keep SQL and migration contracts database-first; generated bindings are
  derived artifacts.
- This package is the canonical home for item migration scripts. Root
  `package.json` may proxy into these commands, but app packages should not
  duplicate them.
- `user_v1.phone` is stored as `text`, not a numeric type. Treat phone numbers
  as identifiers and normalize digits at query boundaries when needed.
- `user_v1.password` stores scrypt hashes in the self-describing
  `scrypt$N$r$p$salt$hash` format (`sql/user/password.ts`). Legacy plaintext
  values still verify and are rehashed on the next successful login. Always
  write passwords through `hashPassword`.
- `claimAnonymousUser` (`sql/user/anonymous.ts`) upgrades an anonymous row into
  a permanent account in place. Identity uniqueness is enforced in application
  code, not by the schema (only `username` has an exact-match DB UNIQUE; email
  and phone have none). Two safeguards make it correct: (1) the proposed
  username and email are each checked against username, email, AND phone-digit
  namespaces of non-anonymous rows — mirroring `findUserByIdentifier`, so a
  claimed identifier can never resolve to a different account at sign-in; (2)
  transaction-scoped `pg_advisory_xact_lock`s on the normalized (lowercased)
  username and email serialize concurrent claims of case-variant identifiers.
  If you add a real DB uniqueness constraint (e.g. `lower()` indexes) later,
  audit existing rows for case-duplicates first and you can then drop the
  advisory locks.
- Because claim flips `is_anonymous` on a live row, `mergeAnonymousUserInto`
  locks its source-anonymity check with `FOR UPDATE`. This serializes a merge
  against a concurrent claim of the same row so the merge cannot delete a row
  that just became a permanent account. Keep that lock if you refactor the
  merge.
- Every table with a foreign key to `user_v1` must be registered in
  `MERGE_TABLE_STRATEGIES` (`sql/user/anonymous.ts`) with the strategy
  `mergeAnonymousUserInto` applies to it (`dedup-remap`, `reparent`, or
  `drop`). `db:verify` diffs the registry against `information_schema` and
  fails on unregistered tables, so a new user-owned table forces a conscious
  merge decision.
- `mergeAnonymousUserInto` also carries the anonymous user's preferences into
  the destination account with a recursive per-property merge
  (`mergePreferenceObjects`): anon leaf values win, real-only keys are kept.
  This is safe because `user_v1.preferences` defaults to `{}` and the app only
  writes a key when the user explicitly changes that setting — key presence
  means "customized", key absence means "still default".
- Tests: `pnpm --filter @lib/db-items test` (node test runner via tsx).
  DB regression suites only touch
  a database when `DB_ITEMS_TEST_URL` (or legacy `DB_NOTES_TEST_URL`) is set;
  they connect only to that explicit test URL. Cursor Cloud and CI use local
  throwaway databases. CI runs the `verify-items` job.
- Users, workspaces, workspace vocabulary, and items share the `apply_row_timestamps_v1()` trigger
  function. Inserts preserve explicitly supplied creation/modification timestamps
  for restore and otherwise use defaults. Updates refresh `time_modified` and
  keep `time_created` stable.
- Fresh empty DB: run `pnpm --filter @lib/db-items db:migrate`, then
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
- For Notes production rollout, verify code first and deploy `notes-next`.
  Railway runs tracked migrations in its pre-deploy command. Manual target-DB
  preflights require explicit authorization; verify the effective target before
  connecting. Regenerate embeddings only when search data is stale.

## Embeddings (semantic search)

Provider: **Jina AI** — Model: `jina-embeddings-v5-text-small` (1024 dims, normalized).

### Key files

- `services/item-embeddings.ts` — canonical Jina client, embedding constants, and text builders
- `services/items-app.ts` — orchestrates embed-on-write (items, categories, tags) and search
- `sql/item/gets.ts` — `searchItemsByEmbedding` SQL: cosine similarity of query vs item `description_embedding`
- `scripts/regenerate-embeddings.mjs` — CLI bulk regeneration (must stay in sync with `item-embeddings.ts`)

### How it works

- **Storing** item descriptions, category labels, and tag labels: Jina API with `task: "retrieval.passage"` → `vector(1024)` in PostgreSQL (HNSW cosine index).
- **Searching**: user query embedded with `task: "retrieval.query"` → cosine similarity against item `description_embedding` in SQL.
- **No text prefix** is added to inputs. Jina v5's `task` parameter selects the asymmetric LoRA adapter internally — manual `Query:`/`Document:` prefixes are unnecessary and harmful when using the API.

### Debug page

`apps/notes-next/app/embeddings/page.tsx` → `POST /api/embeddings/debug` — standalone Jina calls that compare a search query embedding to a note description embedding (the same score production search uses). Separate **Search task** and **Passage task** selects map to the Jina `task` field (defaults: `retrieval.query` / `retrieval.passage`, matching production); you can pick `(none)` to omit `task` and compare behavior.

### Environment

Requires `JINA_API_KEY`. Missing key → `EmbeddingConfigurationError` (500).
