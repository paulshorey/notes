# `@lib/db-notes`

- This package is internal to this monorepo and is consumed directly from TypeScript source.
- Use extensionless relative imports in `.ts` files. Do not add `.js` suffixes unless the package starts emitting build artifacts.
- Keep database helpers here only when they are reused across apps in this repo.

Database-first package for the `DB_NOTES_URL` database.

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
- `mergeAnonymousNotesAppSession` (`services/notes-app.ts`) runs a best-effort
  `mode: "missing"` embedding backfill for the destination user after the
  merge commits, because taxonomy rows/tags inserted by the merge SQL bypass the
  embed-on-write paths. A missing `JINA_API_KEY` or a Jina failure logs a
  warning and never fails the merge.
- Tests: `pnpm --filter @lib/db-notes test` (node test runner via tsx).
  The merge regression suite (`testing/anonymous-merge.test.ts`) only touches
  a database when `DB_NOTES_TEST_URL` is set, and it connects to that URL
  — never to `DB_NOTES_URL`. Cursor Cloud presets both to local throwaway
  databases; CI's verify-notes job runs it against its throwaway migrated
  container.
- `user_v1` and `user_note_v1` share the `apply_row_timestamps_v1()` trigger
  function so `time_modified` refreshes automatically on insert/update while
  `time_created` stays stable after insert.
- Fresh empty DB: run `pnpm --filter @lib/db-notes db:migrate`, then
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

## Taxonomy: Epic > Category > Group > Note

- `user_taxonomy_v1` is one self-referencing table. `level` (1 epic, 2 category,
  3 group) plus a stored generated `parent_level` column and composite foreign
  keys make depth, parent level and same-user ownership declarative — there are
  no triggers and no application-side depth checks. Notes carry `group_id` plus
  a `group_level` pinned to 3 by a CHECK, which is what stops a note from being
  attached to a category or to someone else's group.
- `user_taxonomy_level_v1` holds each user's _word_ for each tier, levels 1-4;
  level 4 names the leaf content ("Note", or "Task") and has no hierarchy rows.
  **Only ever branch on `level`.** Labels are user data: comparing them, or
  putting them in a URL or cache key, breaks the moment someone renames a tier.
- Tier labels preserve case and are unique per user on `lower(label)`. Item
  labels keep the lowercase CHECK, because the upsert-by-label pattern needs a
  deterministic form.
- Every user needs a full epic > category > group chain, or `isSaveableForm` on
  the client is false and autosave returns before the network — a failure that
  looks exactly like success, since the local snapshot reproduces the notes on
  reload. `createAnonymousUser` seeds the chain and the vocabulary in the same
  transaction as the user row, and `listTaxonomyForNotesApp` repairs both lazily.
- `resolveTaxonomyIdForUser` and `resolveTagIdForUser` use
  `ON CONFLICT ... DO UPDATE ... RETURNING id`, not `DO NOTHING`. With
  `DO NOTHING`, a concurrent uncommitted insert of the same label makes the
  insert skip and the follow-up SELECT, on the statement's snapshot, see
  nothing — the statement returns zero rows and the resolve throws. Several
  notes are open at once and each can create a group, so this is reachable.
- Subtree note counts in `listTaxonomyByUser` are fixed-depth aggregates rather
  than a recursive CTE: the depth is three and the client refetches this on a
  coalesced debounce while notes autosave. 5.5 ms against 26-31 ms at 20k notes.
- `NoteRecord` carries `groupId` and no labels. Clients resolve the path from
  the tree they already hold, so a rename needs no note refetch and labels have
  one source of truth. Embedding the path cost ~34% of the notes payload.
- Deleting a taxonomy node requires an explicit `mode`
  (`reassign-children` or `delete-subtree`). There is no default, because
  guessing means either losing notes or moving them somewhere unasked.

## Embeddings (semantic search)

Provider: **Jina AI** — Model: `jina-embeddings-v5-text-small` (1024 dims, normalized).

### Key files

- `services/notes-embeddings.ts` — canonical Jina client, embedding constants, and text builders
- `services/notes-app.ts` — orchestrates embed-on-write (notes + tags) and search
- `sql/note/gets.ts` — `searchNotesByEmbedding` SQL: the note's own description
  similarity, nothing else
- `scripts/regenerate-embeddings.mjs` — CLI bulk regeneration (must stay in sync with `notes-embeddings.ts`)

### How it works

- **Storing** descriptions/tags: Jina API with `task: "retrieval.passage"` → `vector(1024)` in PostgreSQL (HNSW cosine index).
- **Searching**: user query embedded with `task: "retrieval.query"` → cosine similarity in SQL.
- **No text prefix** is added to inputs. Jina v5's `task` parameter selects the asymmetric LoRA adapter internally — manual `Query:`/`Document:` prefixes are unnecessary and harmful when using the API.

### Debug page

`apps/notes-next/app/embeddings/page.tsx` → `POST /api/embeddings/debug` — standalone Jina calls with the same scoring formula. Separate **Search task** and **Passage task** selects map to the Jina `task` field (defaults: `retrieval.query` / `retrieval.passage`, matching production); you can pick `(none)` to omit `task` and compare behavior.

### Environment

Requires `JINA_API_KEY`. Missing key → `EmbeddingConfigurationError` (500).
