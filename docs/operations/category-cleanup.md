# Optional categories and the reserved uncategorized label

Notes belong to one workspace and have zero or more real category links. General
capture starts with no categories; explicit category-context actions select that
category. Clearing the last selection or deleting the last category is supported.

The web category picker shows only the folder icon when empty. The sidebar's
`uncategorized` group is a computed view of notes without links, appears when it
has matching notes, and has no category edit/delete menu. Real categories have no
default identity, oldest-id semantics, protected row, or special sort order.

`contracts/category-name.ts` in `@lib/db-notes` reserves exactly the trimmed,
case-insensitive category name `uncategorized`. UI validation, service validation,
and the cleanup migration's database constraint enforce that rule. Other
vocabularies and longer category names such as `uncategorized ideas` are unaffected.

## Ordered releases

The compatibility/runtime PR must deploy before the cleanup migration PR. The old
server seeds the literal category during bootstrap, including after the category
is removed. Applying the new constraint while an old server still serves traffic
can make workspace startup fail.

1. Merge and deploy the compatibility/runtime PR: remove category seeding,
   implicit assignment, fallback repair, and protection; support empty categories
   in web and Android; validate new names; accept legacy backups. Existing literal
   category rows remain readable during this intermediate release.
2. Verify the exact compatibility commit is serving and old replicas have drained
   in the target environment. Check bootstrap on a workspace with no categories.
3. Merge and deploy the cleanup PR. Its forward migration deletes only category
   rows named `uncategorized` and their links, preserving note rows and other
   memberships, then adds the reserved-name CHECK constraint. A renamed former
   default remains an ordinary category. Railway applies the migration in its
   existing pre-deploy step.
4. Verify no reserved category rows remain, note identities/content/timestamps
   survived, empty-category save and bootstrap work, and a real category with the
   reserved name cannot be created or renamed through the API.

Apply this sequence separately to development and production. In particular,
promote and deploy the compatibility commit to `prod` before promoting cleanup;
a single production promotion containing both steps skips the required serving
compatibility period. Keep the cleanup PR in draft until the target release
ordering is established. No live migration or deployment is implied by local
validation or by the PRs being open.

## Existing data and recovery

The migration does not delete notes or assign replacement categories. Notes with
only the old literal membership become uncategorized; notes with additional
memberships keep them. Existing empty-category notes are unchanged. A meaningful
category that was once the default is retained, regardless of its ID.

Open-note reconciliation removes invalid category IDs without inventing a
fallback, preserves unsaved text, and recomputes clean signatures. Cached drafts
must reconcile against the refreshed workspace before the removed IDs are saved.
Old client tabs can retain stale IDs until refresh; a failed save must preserve
the draft and show its existing error flow.

Version 1 backups remain supported: validate their references first, then discard
the legacy `uncategorized` category and its note references. This prevents restore
from recreating the reserved row while preserving note text and other vocabulary.
Tags or statuses with the same label are unaffected. Before a live migration,
retain the normal target-database backup for operational recovery; historical
migrations are not edited or replayed.

## Validation

Use isolated local databases for `db:migrate`, `db:verify`, and DB-backed tests.
The repository's normal `.env` may point at Railway, so explicitly override both
`DB_NOTES_URL` and `DB_NOTES_TEST_URL` with the intended local targets. The database
suite covers empty-category saves and deletion, backup conversion, and migration
preservation. Web tests cover draft reconciliation and context-free capture;
manual browser checks cover icon-only rendering, placeholder grouping, and
create/rename validation. Android contract validation and APK assembly establish
build compatibility; device acceptance remains a separate check.
