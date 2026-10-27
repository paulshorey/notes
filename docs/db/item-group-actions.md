# Item group actions

Items keep zero or more category links. `uncategorized` remains a reserved
display label for zero links. Renaming that group assigns its current members to
a new or existing named category; new category-free captures remain unattached.

The group target, action union, preview, and result live in
`lib/db-items/contracts/item-group-actions.ts`, included in the generated app
contract. `POST /api/item-groups` previews `{ selection: { workspaceId, target } }`.
`PATCH` executes `{ selection, snapshot, action }`. Both derive user identity from
the cookie session or bearer token; body user IDs and member ID lists are ignored.

Targets are `{ kind: "category", categoryId }` and `{ kind: "uncategorized" }`.
Actions are `{ kind: "rename", label }` and
`{ kind: "delete", deleteItems: boolean }`. Keeping items is valid only for a
real category: remove that category's memberships and preserve other categories.
Deleting items removes them everywhere, including from other categories. Deleting
uncategorized items empties the current group; it can appear again after capture.
Regular category rename does not merge an existing category with the same name.

Actions cover the whole group in one workspace, including non-text items and
items hidden by presentation filters. The preview reports total/text/shared
counts. The Notes dialog discloses non-text and shared items before deletion.

## Shared execution

`sql/item-groups.ts` implements the membership predicate once. Preview and
execution use it under repeatable-read transactions. Execution locks item rows in
ID order, then the source category, rechecks the fingerprint, dispatches through
the typed action registry, and returns committed item/category changes. Membership
edits touch item modification timestamps; label-only category rename does not.
Single and bulk deletion share `sql/item/delete.ts`. Existing category PATCH and
keep-items DELETE helpers delegate to the same engine, preserving old API shapes.

The SHA-256 fingerprint includes authenticated user/workspace/target, source
category identity/label/revision, and ordered item IDs/revisions/category links.
It is a change detector, not a permission token or long-lived group ID. PostgreSQL
row revisions avoid timestamp precision loss. Changes before execution, serialization
failures, and deadlocks return 409; no mutation is automatically retried against a
new selection. A timeout or lost response requires a new preview and explicit
confirmation. Newly arrived items are never swept into a replay of an old preview.

Rename preparation validates authorization and snapshot before provider work.
Reusing an existing category does not call Jina. A new/renamed label uses the
existing embedding service before acquiring the transaction client; execution
then checks the snapshot again. Item text embeddings are preserved.

To add a member action, extend the tagged contract, strict request parser, and
registry handler, then regenerate the contract and add database/HTTP coverage.
Reuse the selector, locking, authorization, preview, and transaction pipeline.
Add new selectors only when they have a defined membership rule. New capability
tables must also participate in canonical item deletion; category membership does
not imply exclusive ownership of an item.

## Client coordination and compatibility

The Zustand group dialog pauses autosave and exit PATCHes. It settles in-flight
saves and flushes dirty persisted entries before preview; untouched/unsaved drafts
are not silently persisted for the action. Deferred detached saves resume once on
close. The result repairs open entries and caches immediately, removes deleted
entries without detached saves, then refreshes counts/search. A refresh failure
does not make a completed mutation available for replay. Session/workspace changes
invalidate pending dialog responses.

This feature does not introduce general item revision checks for older clients.
A stale item PATCH receives 404 after deletion; an older client may still submit
its previous memberships after an assignment, as ordinary item updates already
allow. General optimistic editing remains a separate item-lifecycle change.

No new schema migration, default-category row, pointer, background job, or backup
format is introduced. Existing reserved-name constraints, v1/v2 backup handling,
legacy SQL views, and category-free bootstrap remain in place.
