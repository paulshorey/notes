# Item group actions

An item is filed in at most one category and one subcategory of that category
([item taxonomy](item-taxonomy.md)). `uncategorized` is a reserved display label
for items with no category. Renaming that group files its current members in a new
or existing category; later captures without a category remain unfiled.

The group target, action union, preview, and result live in
`lib/db-items/contracts/item-group-actions.ts`, included in the generated app
contract. `POST /api/item-groups` previews `{ selection: { workspaceId, target } }`.
`PATCH` executes `{ selection, snapshot, action }`. Both derive user identity from
the cookie session or bearer token; body user IDs and member ID lists are ignored.

Targets are `{ kind: "category", categoryId }`,
`{ kind: "subcategory", subcategoryId }`, `{ kind: "uncategorized" }`, and
`{ kind: "item", itemId }`. A category group holds every item filed in the
category, including those in its subcategories. A subcategory group holds its own
items. The single-item selector is available for workspace moves.

Actions include `{ kind: "rename", label }`, `{ kind: "delete", deleteItems: boolean }`,
`{ kind: "move", categoryId: number | null }`, and
`{ kind: "move-to-workspace", destinationWorkspaceId }`.

| Target        | Rename                                | Delete, keep items                                    | Delete with items                         |
| ------------- | ------------------------------------- | ----------------------------------------------------- | ----------------------------------------- |
| Category      | Changes the label                     | Items become uncategorized; subcategories are removed | Items and subcategories are removed       |
| Subcategory   | Changes the label within its category | Items stay in the category, without a subcategory     | Only that subcategory's items are removed |
| Uncategorized | Files the items in the named category | Not allowed                                           | The unfiled items are removed             |

Renaming a category or subcategory to a label that already exists at that level is
a conflict, not a merge. Deleting uncategorized items empties the current group; it
can appear again after capture.

Move puts a group somewhere else in the hierarchy and keeps its items in it:

| Target      | `categoryId` | Result                                                                                     |
| ----------- | ------------ | ------------------------------------------------------------------------------------------ |
| Subcategory | a category   | The same subcategory row under that category; its items follow                             |
| Subcategory | `null`       | A category with the subcategory's label; its items are filed in it with no subcategory     |
| Category    | a category   | A subcategory of that category with the category's label; its items keep it as subcategory |

A category can move into another only while it has no subcategories, because the
hierarchy is two levels. A label that already exists at the destination, the
subcategory's current category, and a category moved into itself are conflicts; a
destination outside the workspace is not found. Unfiled items have no group to move:
naming a category for them is the rename action. A move never deletes an item and
needs no embedding provider; a category created by a move gets its label embedding
from the next embedding maintenance run.

## Moving between workspaces

The item editor and the sidebar item and group menus offer **Move to workspace**.
Both workspaces must belong to the authenticated account, including visitor accounts.
The items keep their IDs, public links, timestamps, content, and embeddings. The
destination reuses categories, subcategories, tags, and statuses with the same
label. A subcategory match is scoped to its parent category. The move creates missing
labels from the source, preserving taxonomy metadata for those new rows.

An item or group deletion and a workspace move prune unreferenced categories,
subcategories, tags, and statuses in the affected source workspace, inside the
same transaction. If it has no items left, cleanup removes the workspace. The
account gets a fresh starter workspace when it has no other workspace for capture.

Actions cover the whole group in one workspace, including non-text items and
items hidden by presentation filters. The preview reports the item count, the text
item count, and for a category the number of subcategories removed with it. The
Notes dialog discloses non-text items and those subcategories before deletion.

## Shared execution

`sql/item-groups.ts` implements the membership predicate once. Preview and
execution use it under repeatable-read transactions. A cleanup operation first locks the account's workspaces in ID order. Group
execution locks selected item rows in ID order, then the target category or
subcategory and, for a category, its subcategories. It rechecks the fingerprint, dispatches through the typed action
registry, and returns the committed items and the affected category (for a
subcategory, its refreshed parent; for a move within the workspace, the destination).
A workspace move returns the IDs removed from the source view and the destination
workspace ID. A move within the workspace also locks its destination category
after the target. An ordinary item save locks its item row before its foreign
keys touch a category.

Unfiling or refiling is an update of the item row, so it moves the item's
modification time; a label-only rename does not. The item foreign keys take no delete action, so the
engine always unfiles or deletes the member items before removing a category or
subcategory. Single and bulk deletion share `sql/item/delete.ts`. The category
PATCH and keep-items DELETE routes delegate to the same engine.

The SHA-256 fingerprint includes authenticated user/workspace/target, the target
category and subcategory identity/label/revision, a category's subcategories, and
ordered item IDs/revisions with their category and subcategory.
It is a change detector, not a permission token or long-lived group ID. PostgreSQL
row revisions avoid timestamp precision loss. Changes before execution, serialization
failures, deadlocks, and an item filed in the target while a delete waits for the
target's lock return 409; no mutation is automatically retried against a
new selection. A timeout or lost response requires a new preview and explicit
confirmation. Newly arrived items are never swept into a replay of an old preview.

Rename preparation validates authorization and snapshot before provider work.
Reusing an existing category does not call Jina. A new or renamed category label
uses the embedding service before acquiring the transaction client; execution then
checks the snapshot again. A subcategory label has no embedding and needs no
provider. Item text embeddings are preserved.

To add a member action, extend the tagged contract, strict request parser, and
registry handler, then regenerate the contract and add database/HTTP coverage.
Reuse the selector, locking, authorization, preview, and transaction pipeline.
Add new selectors only when they have a defined membership rule. New capability
tables must also participate in canonical item deletion.

## Client coordination

The Zustand group dialog pauses autosave and exit PATCHes. It settles in-flight
saves and flushes dirty persisted entries before preview; untouched/unsaved drafts
are not silently persisted for the action. Deferred detached saves resume once on
close. The result repairs open entries and caches immediately and closes deleted
or moved entries without detached saves. After cleanup the client refreshes workspace
and taxonomy lists and carries any unsaved drafts into the fallback workspace if the
source was removed. After a move within the workspace, the
response names only the destination category, so `applyItemGroupResultToCategories`
takes the moved subcategory out of the category that still lists it, and
`refileAfterGroupResult` points a draft that was being filed in the moved group at
its new place, since no server item exists to carry that change. A refresh failure
does not make a completed mutation available for replay. Session/workspace changes
invalidate pending dialog responses.

A stale item PATCH receives 404 after deletion and 409 when the item is now in
another workspace. A client holding an older copy can still save its previous
category after group actions within the same workspace.
