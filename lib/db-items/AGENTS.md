# `@lib/db-items`

- This package is internal to this monorepo and is consumed directly from TypeScript source.
- Use extensionless relative imports in `.ts` files. Do not add `.js` suffixes unless the package starts emitting build artifacts.
- Keep database helpers here only when they are reused across apps in this repo.

Database-first package for the `DB_ITEMS_URL` database (`DB_NOTES_URL` is read when it is unset).
See `docs/db/item-core.md` for the item domain and `docs/db/item-model.md` for the item model.

## Workspace ownership model

- `user_v1` owns `user_workspace_v1`; items and all item vocabulary are owned through a workspace.
- Items and workspaces each have a `uid` (uuid, unique, never changed) beside the integer
  `id`. The uid is the public identity; integer ids stay the keys. `createOrFindItemForUser`
  inserts with `ON CONFLICT (uid) DO NOTHING` and reports `created: false` when the uid named
  an existing item of that workspace, and refuses a uid held anywhere else. See the
  Identity section of `docs/db/item-core.md`.
- Every item has one `workspace_id`, one nullable `category_id`, one nullable `subcategory_id`, one nullable `status_id`, and zero or more tag links. See `docs/db/item-taxonomy.md`.
- A subcategory (`workspace_subcategory_v1`) belongs to one category and is unique by label within it. The hierarchy is exactly two levels. Categories, statuses, and tags are unique by normalized label within a workspace, and status and tags are not part of the hierarchy.
- An item's subcategory always belongs to its category: composite foreign keys enforce it, and `resolveItemFiling` (`sql/item/shared.ts`) clears a subcategory that does not fit instead of failing the save. The item foreign keys take no delete action, so remove a category or subcategory only through the group engine, never with a bare `DELETE`.
- Categories have no seeded default or protected row. `uncategorized` is a reserved, display-only label for an item with no category. Use `contracts/category-name.ts` for category create/rename validation; backup parsing drops a category with that literal label after validating references. See `docs/operations/category-cleanup.md`.
- Composite foreign keys enforce that every item relation comes from the item's own workspace.
- `contracts/item-model.ts` declares the item model as data: capabilities, taxonomy
  fields, kinds, and write rules. Each capability has a role: content (text, time, day)
  makes an item exist, and state (schedule, status) describes one and never keeps it
  alive. A state may name what it `requires`: a status requires text. Declare a new
  field, capability, or kind there instead of branching on fields;
  `contracts/item-capabilities.ts` and `contracts/item-kinds.ts` derive from it.
  `itemModelDocument()` is served at `GET /api/items/model` and committed as
  `generated/contracts/item-model.json`, which `app:contract:generate` writes and
  `app:contract:check` checks (`scripts/generate-item-model.ts`).
  `assertItemHasContent` applies the save rules (`hasItemContent`: at least one content
  capability; `missingRequirement`: each state has what it requires) in
  `createItemForItemsApp` and, to the merged result, in `updateItemForUser`. The check
  constraints `workspace_item_v1_content_check` and
  `workspace_item_v1_status_requires_text_check` repeat them, so a test or script cannot
  insert an item the rules refuse.
  `ITEM_HAS_CONTENT_SQL` (`sql/item/stored-capabilities.ts`) is the content rule over
  an item row. Listing, group actions, backup, restore, account merge, and the trash
  carry an item whatever content it holds: no layer may name text as the content it
  expects. Deleting a status clears it from its items and deletes none.
- A create takes a whole `ItemInput`: a field it omits is empty (`sql/item/parse.ts`).
  An update takes an `ItemPatch`: an absent field is left as stored, `null` clears it,
  and `tagIds: []` removes every tag. `workspaceId` is optional in a patch and must be
  the item's workspace. `updateItemForUser` (`sql/item/update.ts`) locks the row, merges
  the patch, and applies the save rules to the result.
- A time block is `time_start` and `time_end`, set together. `normalizeTimeBlock`
  (`contracts/item-time.ts`) fills in a missing end from the other. An update that
  names neither time field keeps the stored block, and `null` removes it. See Time blocks in `docs/db/item-core.md`.
- A journal entry is an item with an `entry_date`, a plain date read and written as
  `YYYY-MM-DD` text, never through a driver `Date`. One entry per workspace and day is
  kept by a unique index, and a write that breaks it throws `JournalDayTakenError`
  (HTTP `409`). `sql/item/journal.ts` combines two entries: account merge and backup
  restore do it without asking and remove the entry they combine, and a user-driven
  write does it only when asked and keeps the entry the text came from, emptied. See
  Journal entries in `docs/db/item-core.md`.
- A kind (`note`, `task`, `time`, `journal`) names what an item holds. It is computed
  by `contracts/item-kinds.ts` from the item model, never stored, and an item can be
  several kinds. Write a view's selection with `isKind` instead of testing fields.
- `updateItemForItemsApp` accepts `expectedTimeModified`, the version the caller edited.
  A stale one throws `ItemChangedError` with the stored item (HTTP `409 item_changed`)
  and writes nothing; the comparison is made on the locked row, at millisecond precision. See
  Concurrent edits in `docs/db/item-core.md`.
- Deleting an item moves it to `user_item_trash_v1` in the same statement
  (`TRASH_ITEMS_SQL`, used by `sql/item/delete.ts`, the one place items are deleted on
  a user's request). A trash entry is the item's backup fields as JSON, so it is built
  from the stored-capability registry and no query over items has to exclude it.
  `sql/item/trash.ts` lists in pages of 200, restores (an import of that one item,
  after writing back its workspace and vocabulary by label), and purges. Entries older
  than `TRASH_RETENTION_DAYS` (`contracts/item-model.ts`) are removed on every list and
  every delete. `deleteItemForUser` retries a serialization failure up to three times
  before throwing a conflict. See the Trash section of
  `docs/db/item-core.md`.
- `contracts/item-group-actions.ts` defines group selection and tagged actions.
  `sql/item-groups.ts` owns the shared predicate, preview fingerprint, transaction,
  and action registry for category, subcategory, and uncategorized targets.
  Workspace moves also support a single item. Add future member actions to the
  registry. Execution reauthorizes workspaces and derives IDs on the server.
- Both existing category mutation helpers and bulk routes use that engine.
  Lock item rows in ID order before category and subcategory rows, and unfile or
  delete items before removing the row that files them. Single and bulk item
  deletion share `sql/item/delete.ts`. Deletions and workspace moves run
  `sql/workspace-cleanup.ts` in the same transaction: it removes the categories,
  subcategories, and tags no item uses, and keeps statuses and the workspace itself.
  Only `deleteWorkspaceForUser` (`sql/workspace-delete.ts`) removes a workspace: it
  sends the workspace's items to the trash first and refuses when the caller's
  `expectedItemCount` does not match. Group actions call no embedding provider. See
  `docs/db/item-group-actions.md` at the repository root for semantics and limits.

## Source of truth

- `migrations/`: canonical schema change history
- `schema/current.sql`: generated snapshot of expected schema
- `queries/`: the place for SQL query contracts shared across runtimes; it holds none
- `contracts/items-app.ts`: canonical app-facing item contract
- `contracts/item-model.ts`: the item model
- `generated/contracts/items-app.json`, `generated/contracts/item-model.json`: generated contract artifacts

## TypeScript adapter

- `lib/db/postgres.ts`: process-wide connection pool for app/runtime code. It defaults to one connection so cold, parallel Next.js requests do not burst connections through a remote proxy; set `PG_POOL_MAX` explicitly when a deployment needs more concurrency.
- `services/items-app.ts`: Item workflow layer used by the web app's API routes.
  `describeItemsAppError` maps every thrown error to a status, an `ErrorCode`
  (`contracts/items-app.ts`), and a message. Throw `InvalidRequestError`
  (`contracts/request-error.ts`), or a subclass, for anything a caller can correct: it is
  answered `400` with its message. Every other error is a server fault, answered
  `500 internal` with a generic message. A unique-label violation is `409 conflict`.
- `contracts/user-backup.ts`: versioned portable-backup validation and size limits;
  safe to import in the browser.
- `sql/user/backup.ts`: snapshot export and atomic staged restore. Restore calls
  `mergeAnonymousUserIntoWithClient` on the same client/transaction; do not use
  the pool-acquiring merge wrapper inside a transaction (pool defaults to one).
- `sql/item/stored-capabilities.ts`: the server half of the capability registry.
  Backup export and import, duplicate detection, and account merge are generated
  from it. Never list item columns by hand in those paths; declare the column or
  table under the part that owns it. A table entry must name the backup field that
  exports its rows and the statement that imports them, plus `rehome` if its rows
  point into the workspace. `db:verify` runs
  `scripts/audit-item-storage.ts` and fails on an item column or item-referencing
  table that nothing declares, a backup field that restore never writes, and an owned
  table that points into the workspace without `rehome`.

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
- Account merge moves item rows; it never copies them. An item keeps its id, so
  its embeddings and any table keyed by `item_id` follow without merge code. Columns
  that point into the old workspace are re-pointed by label through each part's
  `rehome` entry. The merge sets `app.keep_time_modified` for those statements so
  the timestamp trigger keeps each row's modification time.
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
  a database when `DB_ITEMS_TEST_URL` (or `DB_NOTES_TEST_URL`) is set;
  they connect only to that explicit test URL. Cursor Cloud and CI use local
  throwaway databases. CI runs the `verify-items` job.
- Users, workspaces, workspace vocabulary, and items share the `apply_row_timestamps_v1()` trigger
  function. Inserts preserve explicitly supplied creation/modification timestamps
  for restore and otherwise use defaults. Updates refresh `time_modified` and
  keep `time_created` stable.
- Fresh empty DB: run `pnpm --filter @lib/db-items db:migrate`, then
  `db:verify`.
- A database that has the baseline schema but no migration ledger: run
  `db:migrate:baseline` once, then `db:migrate`, then `db:verify`.
- `db:migrate:baseline` is a recovery tool, not a standard release step.
- `db:verify` is not read-only; it runs `db:migrate` first.
- Only run `db:migrate` / `db:verify` against a deployed remote DB when the
  user explicitly requests it. Check connectivity and pending migrations first.
- Never manually create or alter tables outside migrations.
- Migration files are forward-only SQL; do not add `BEGIN` / `COMMIT`.
- For populated tables, migrations must explicitly backfill data and explicitly
  convert types with `USING` where needed.
- After schema changes, keep `migrations/`, `schema/current.sql`, generated
  artifacts, and app contracts in sync.
- **`scripts/verify-contract.mjs` must be updated alongside every migration.**
  When adding columns/indexes/constraints, add corresponding assertions. When
  dropping columns/indexes/constraints, replace "must exist" assertions with
  "must be absent" assertions.
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
- `services/items-app.ts` — `embedItemForItemsApp`, embedding maintenance, and search
- `sql/item/gets.ts` — `searchItemsByEmbedding` SQL: cosine similarity of query vs item `description_embedding`
- `scripts/regenerate-embeddings.mjs` — CLI bulk regeneration (must stay in sync with `item-embeddings.ts`)

### How it works

- **Writes never wait on the provider.** A new item, or one whose text changed, is stored with no embedding (`description_embedding`, `embedding_model`, and `embedding_updated_at` are cleared). The route handler calls `embedItemForItemsApp` after the response is sent, for a create, an update, a trash restore, and a journal combine. When the provider fails the item stays unembedded and `POST /api/items/maintenance/embeddings` repairs it.
- `updateItemEmbeddingsForUser` stores an embedding only while the item still holds the embedded text, and sets `app.keep_time_modified` so `time_modified` does not move.
- Category and tag labels are stored without an embedding on create, and a rename clears it. Only embedding maintenance writes label embeddings.
- **Storing** item descriptions, category labels, and tag labels: Jina API with `task: "retrieval.passage"` → `vector(1024)` in PostgreSQL (HNSW cosine index).
- **Searching**: user query embedded with `task: "retrieval.query"` → cosine similarity against item `description_embedding` in SQL.
- **No text prefix** is added to inputs. Jina v5's `task` parameter selects the asymmetric LoRA adapter internally — manual `Query:`/`Document:` prefixes are unnecessary and harmful when using the API.

### Debug page

`apps/notes-next/app/embeddings/page.tsx` → `POST /api/embeddings/debug` — standalone Jina calls that compare a search query embedding to a note description embedding (the same score production search uses). Separate **Search task** and **Passage task** selects map to the Jina `task` field (defaults: `retrieval.query` / `retrieval.passage`, matching production); you can pick `(none)` to omit `task` and compare behavior.

### Environment

`JINA_API_KEY` is needed for search and embedding maintenance; saving works without it. A missing key or a provider failure on those routes answers `503 search_unavailable`.
