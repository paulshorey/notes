# Optional categories and the reserved uncategorized label

Notes belong to one workspace and are filed in at most one category
([item taxonomy](../db/item-taxonomy.md)). General capture starts with no category;
explicit category-context actions select that category. Clearing the selection or
deleting the last category is supported.

The web category picker shows only the folder icon when empty. The sidebar's
`uncategorized` group is a computed view of notes without a category, appears when it
has matching notes, and has no category edit/delete menu. Real categories have no
default identity, oldest-id semantics, protected row, or special sort order.

`contracts/category-name.ts` in `@lib/db-items` reserves exactly the trimmed,
case-insensitive category name `uncategorized`. UI validation, service validation,
and the cleanup migration's database constraint enforce that rule. Other
vocabularies and longer category names such as `uncategorized ideas` are unaffected.
The database uses the explicit ECMAScript trim character set, including tabs,
line terminators, non-breaking spaces, Unicode space separators, and the BOM.
PostgreSQL's default `btrim()` only removes ordinary spaces and is insufficient.

Two migrations own the rule: `202610182100__retire_default_category.sql` and
`202610192200__normalize_reserved_category_name.sql`. Together they delete category
rows whose trimmed, case-insensitive name is `uncategorized`, with their links, and
add the reserved-name CHECK that applies the same normalization to inserts and
updates. Note rows, other vocabulary, and longer category names are untouched.
Both files are recorded in migration ledgers; keep their contents and checksums.

Verify the effective database target before publishing migration changes to a
preview. A preview can share development's database, and its pre-deploy command
applies migrations before a main merge. A successful preview does not establish
database isolation. Keep manual migration tests on explicitly selected local
databases.

## Drafts and backups

Open-note reconciliation removes invalid category IDs without inventing a
fallback, preserves unsaved text, and recomputes clean signatures. Cached drafts
reconcile against the refreshed workspace before their category IDs are saved.
A client tab can hold stale IDs until refresh; a failed save preserves the draft
and shows its existing error flow.

Version 1 backups are supported: restore validates their references first, then
discards an `uncategorized` category and its note references. This keeps restore
from creating the reserved row while preserving note text and other vocabulary.
Tags or statuses with the same label are unaffected.

## Validation

Use isolated local databases for `db:migrate`, `db:verify`, and DB-backed tests.
The repository's normal `.env` may point at Railway, so explicitly override both
`DB_ITEMS_URL` and `DB_ITEMS_TEST_URL` with the intended local targets
(the `DB_NOTES_*` names are supported fallbacks). The database
suite covers empty-category saves and deletion, backup conversion, and migration
preservation. Whitespace regression tests run both migrations as a fresh chain
and the second as an upgrade from the first; they check
all 25 ECMAScript trim characters, direct SQL insert/rename rejection, unchanged
note rows and tag links, cross-workspace cleanup, and retained longer names.
Web tests cover draft reconciliation and context-free capture;
manual browser checks cover icon-only rendering, placeholder grouping, and
create/rename validation.
