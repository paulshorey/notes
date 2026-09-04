# Deploy: Epic > Category > Group > Note hierarchy

Target: production Notes Postgres (Railway), then merge
[PR #70](https://github.com/paulshorey/notes/pull/70) so Railway deploys the
new `notes-next`. Phase 2 (drop `category_id` / `user_note_category_v1`) waits
until you have tested the live app.

## Why this order

Phase 1 makes `user_note_v1.group_id` `NOT NULL`. The currently deployed app
writes `category_id` only, so **note creates fail in the window between the
migration and the Railway deploy**. Reads of existing notes still work. The
window should stay minutes, not hours: migrate, then merge immediately.

Phase 2 must not run until the new code is the only writer. Dropping
`category_id` while any old process is still up breaks it.

## What I will do now

1. Preflight the production DB (checksums, backfill dry-run).
2. Apply only `202609012013__note_taxonomy_hierarchy.sql` via `pnpm run db:migrate`.
3. Verify hierarchy invariants with read-only SQL. Do **not** run `db:verify`
   against production — it rewrites local generated files.
4. Mark PR #70 ready and merge it into `main` (merge commit, same as #69).
5. Stop. You test. Phase 2 is a follow-up.

## What I will not do now

- Phase 2 DDL (drop `user_note_v1.category_id` and `user_note_category_v1`).
- Embedding backfill of taxonomy labels (`label_embedding` stays NULL; literal
  autocomplete still works).
- Android APK rebuild. The new web API no longer serves `/api/categories`; an
  older APK talking to production will break after the Railway deploy.

## Production DB as of preflight

Identified via the injected `MARKETING_DB_URL` secret (notes-next lives under
`/marketing/apps/notes-next` in Infisical). Postgres 17.11. No taxonomy tables
yet.

| | count |
| --- | --- |
| users | 288 (4 real, 284 anonymous) |
| notes | 204 (all have a category) |
| categories | 59 (no duplicate labels per user) |
| users with zero categories | 266 (anonymous visitors; they get a seeded chain) |

Checksums of every overlapping migration file match. Two production-only
migrations stay untouched:

- `202604071200__gemini_embedding_001_768.sql`
- `202606201200__user_workflow_status.sql` (`user_workflow_status_v1`, plus
  `user_note_v1.workflow_status_id` / `time_completed`)

The runner only applies local files that are not already recorded, so those
extra objects are left alone. Workflow-status rows: 10 statuses, 1 note using
one. The user FK is `ON DELETE CASCADE`, so anonymous merge still deletes
cleanly.

## After merge — please test

Production web: `https://notes-apps-notes-next.up.railway.app`

Hard-refresh so the `notes-app-cache-v2` client cache replaces v1.

1. Existing notes still open and show a breadcrumb
   `epic → category → group` (seeded groups are `uncategorized`).
2. Create a note, reload with cache cleared, confirm it is in Postgres
   (`user_note_v1.group_id`), not only in `localStorage`.
3. Move a note between groups; rename a group; expand the sidebar tree.
4. Open several notes and confirm background autosave still works.
5. Optional: rename a tier (Epic/Category/Group/Note) and confirm the UI
   uses the new word without breaking filters.

When that looks good, say so and I will land Phase 2.

## Rollback

You already have a DB backup. If the migration itself fails it is one
transaction and rolls back. If the new app is wrong after merge:

1. Revert the Railway deploy to the previous `notes-next` image.
2. Restore the backup. Do not try to reverse the SQL by hand — Phase 1 is
   forward-only and already wrote `group_id`.
3. Do not run Phase 2.

## Phase 2 (later, after you test)

New migration that:

```sql
ALTER TABLE public.user_note_v1 DROP COLUMN category_id;
DROP TABLE public.user_note_category_v1;
```

Also flip `verify-contract.mjs` from "must exist / category_id nullable" to
"must be absent", drop `user_note_category_v1` from `MERGE_TABLE_STRATEGIES`,
and remove the leftover category-remap SQL in `mergeAnonymousUserInto`.
