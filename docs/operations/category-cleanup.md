# Optional categories and the reserved uncategorized label

Notes belong to one workspace and have zero or more real category links. General
capture starts with no categories; explicit category-context actions select that
category. Clearing the last selection or deleting the last category is supported.

The web category picker shows only the folder icon when empty. The sidebar's
`uncategorized` group is a computed view of notes without links, appears when it
has matching notes, and has no category edit/delete menu. Real categories have no
default identity, oldest-id semantics, protected row, or special sort order.

`contracts/category-name.ts` in `@lib/db-items` reserves exactly the trimmed,
case-insensitive category name `uncategorized`. UI validation, service validation,
and the cleanup migration's database constraint enforce that rule. Other
vocabularies and longer category names such as `uncategorized ideas` are unaffected.
The database uses the explicit ECMAScript trim character set, including tabs,
line terminators, non-breaking spaces, Unicode space separators, and the BOM.
PostgreSQL's default `btrim()` only removes ordinary spaces and is insufficient.

The original `202610182100__retire_default_category.sql` has already been recorded
in development's migration ledger. Preserve that file and checksum. The forward
`202610192200__normalize_reserved_category_name.sql` removes any whitespace-padded
reserved rows missed by the original cleanup, then replaces the reserved-name
CHECK using the same normalization for deletion and future inserts/updates.
This works both on fresh databases and databases that applied the original.
Only reserved category rows and their links are removed; note data, other
memberships, renamed categories, tags, and statuses remain intact.

Verify the effective database target before publishing migration changes to a
preview. The PR #102 preview was confirmed to share development's database; it
is not disposable. Its pre-deploy command can apply migrations before a main
merge. A successful preview does not establish database isolation. Keep all
manual migration tests on explicitly selected local databases.

## Ordered releases

Runtime compatibility is [PR #101](https://github.com/paulshorey/notes/pull/101),
merged as `f880f54f63248a0d0939b730e796d7b8bf4c3901`. Deploy that commit (or a
later commit containing it) before the migrations in the cleanup PR. The sidebar
note-action follow-up [PR #104](https://github.com/paulshorey/notes/pull/104) is
merged into `main` and included when this feature branch synchronizes with it.

The compatibility/runtime PR must deploy before the cleanup migration PR. The old
server seeds the literal category during bootstrap, including after the category
is removed. Applying the new constraint while an old server still serves traffic
can make workspace startup fail.

1. Merge and deploy the compatibility/runtime PR: remove category seeding,
   implicit assignment, fallback repair, and protection; support empty categories
   in the web app; validate new names; accept legacy backups. Existing literal
   category rows remain readable during this intermediate release.
2. Verify the exact compatibility commit is serving and old replicas have drained
   in the target environment. Check bootstrap on a workspace with no categories.
3. Merge and deploy the cleanup PR. Its forward migrations delete only category
   rows whose trimmed, case-insensitive name is `uncategorized` and their links,
   preserving note rows and other memberships, then add the reserved-name CHECK
   constraint. A renamed former default remains an ordinary category. Railway
   applies the migrations in its existing pre-deploy step.
4. Verify no reserved category rows remain, note identities/content/timestamps
   survived, empty-category save and bootstrap work, and a real category with the
   reserved name cannot be created or renamed through the API.

Apply this sequence separately to development and production. In particular,
promote and deploy the compatibility commit to `prod` before promoting cleanup;
a single production promotion containing both steps skips the required serving
compatibility period. Keep the cleanup PR in draft until the target release
ordering is established. No live migration or deployment is implied by local
validation; account for automatic preview pre-deploy migrations separately.

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
`DB_ITEMS_URL` and `DB_ITEMS_TEST_URL` with the intended local targets
(the legacy `DB_NOTES_*` names remain supported fallbacks). The database
suite covers empty-category saves and deletion, backup conversion, and migration
preservation. Whitespace regression tests run the actual original/corrective SQL
both as a fresh chain and as an upgrade to the original constraint; they check
all 25 ECMAScript trim characters, direct SQL insert/rename rejection, unchanged
note rows and tag links, cross-workspace cleanup, and retained longer names.
Web tests cover draft reconciliation and context-free capture;
manual browser checks cover icon-only rendering, placeholder grouping, and
create/rename validation.
