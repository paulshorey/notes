# Deploy: Epic > Category > Group > Note hierarchy

Phase 1 shipped in [PR #70](https://github.com/paulshorey/notes/pull/70).
Phase 2 shipped in [PR #72](https://github.com/paulshorey/notes/pull/72) (`8fd46ba`
fast-forwarded to `main`) and was applied to production on 2026-09-06 after
Railway deployed that commit to `jot.new`.

`user_note_v1.category_id` and `user_note_category_v1` are gone. Notes remain
on `group_id`. Production-only `user_workflow_status_v1` was left alone.
Embedding backfill of `user_taxonomy_v1.label_embedding` is still deferred.

## Why the two-phase order

Phase 1 made `user_note_v1.group_id` `NOT NULL` and left the old category
table/column for the rollback window. The then-deployed app still wrote
`category_id` only, so note creates would have failed if the new code was not
deployed immediately after that migration.

Phase 2 could not run until the new code was the only writer. Live main after
PR #70 still remapped `user_note_category_v1` during anonymous merge, so
dropping the table before `8fd46ba` reached Railway would have broken sign-in
merge.

## Phase 1 (done 2026-09-04)

Applied `202609012013__note_taxonomy_hierarchy.sql`, then merged PR #70.
Production-only migrations stayed untouched:

- `202604071200__gemini_embedding_001_768.sql`
- `202606201200__user_workflow_status.sql` (`user_workflow_status_v1`, plus
  `user_note_v1.workflow_status_id` / `time_completed`)

Preflight counts at that time: 288 users, 204 notes (all categorized), 59
legacy categories. Hierarchy invariants were clean.

## Phase 2 (done 2026-09-06)

1. Landed code that no longer touches the leftover table (`8fd46ba` on `main`).
2. Waited for Railway production (`Success - jot.new`).
3. Applied `202609060100__drop_legacy_note_category.sql` via
   `DB_NOTES_URL=<prod> pnpm --filter @lib/db-notes db:migrate`.
4. Read-only checks only. Did **not** run `db:verify` against production.

Post-drop production checks:

| check | result |
| --- | --- |
| leftover table | absent |
| `user_note_v1.category_id` | absent |
| `user_note_v1_category_id_idx` | absent |
| notes | 208, all on `group_id` |
| hierarchy orphans | 0 |
| `user_workflow_status_v1` | still present |
| `jot.new` `/api/health` | healthy |
| `/api/categories` | 404 |
| `/api/taxonomy` | 401 unauth (route present) |

## Still deferred

- One-off backfill of `user_taxonomy_v1.label_embedding`. Literal autocomplete
  still works until then.
