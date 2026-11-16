# Item taxonomy

Taxonomy is where an item is filed. It is the same for every kind of content, and it
never counts as content: a category, a subcategory, or a tag does not make an item.

| Level       | Per item    | Stored as                          |
| ----------- | ----------- | ---------------------------------- |
| Workspace   | exactly one | `workspace_item_v1.workspace_id`   |
| Category    | at most one | `workspace_item_v1.category_id`    |
| Subcategory | at most one | `workspace_item_v1.subcategory_id` |
| Tags        | any number  | `item_tag_link_v1`                 |

A subcategory (`workspace_subcategory_v1`) belongs to exactly one category, and its
label is unique within that category, so two categories can each have an `ideas`. A
category label is unique within its workspace. Both levels are optional: an item can be
filed directly in a category, or in none. An item with no category displays under
`uncategorized`, which is display text and a reserved category and subcategory name
(`contracts/category-name.ts`), never a row.

The hierarchy is exactly two levels. Status is not taxonomy: it is a capability, and a
workspace has one list of statuses.

## What the database guarantees

- `(category_id, workspace_id)` references the category, so an item cannot be filed in
  another workspace's category.
- `(subcategory_id, category_id)` references the subcategory, so an item's subcategory
  always belongs to the item's category. Moving a subcategory to another category
  (`ON UPDATE CASCADE`) moves its items with it.
- A check constraint rejects a subcategory without a category.
- Neither item foreign key takes a delete action. A category or subcategory that still
  files an item cannot be deleted by a bare `DELETE`; the group engine unfiles or
  deletes the items first, in the same transaction
  ([item group actions](item-group-actions.md)). Deleting a workspace still removes its
  items, categories, and subcategories together.

`db:verify` asserts the columns, constraints, indexes, and the two foreign keys' actions.

## Writing an item

`ItemInput` carries `categoryId` and `subcategoryId`. The category must belong to the
item's workspace, or the write is refused. A subcategory is kept only when it belongs to
that category, so choosing another category, or none, clears a subcategory left over
from the old one instead of failing the save.

`ItemRecord` returns `category` and `subcategory` as `{ id, label }` or `null`.

## Categories and subcategories

`CategoryRecord` nests its `subcategories`. A category's `itemCount` and `lastUsedAt`
cover every item filed in it, in a subcategory or not; a subcategory's cover its own
items.

`POST /api/categories` creates a category, or, with a `categoryId`, finds or creates a
subcategory of that category and returns it with the refreshed parent. Renaming,
deleting, and moving either level goes through the group engine: a subcategory can
move to another category or become a category, and a category without subcategories
can become a subcategory of another. A subcategory label has no
embedding.

## Account merge, backup, and duplicate detection

Signing in to an existing account matches a category by its label and a subcategory by
its label within the category of the same label, then files each item under the
account's rows. Backup version 3 nests `subcategories` under each category and stores
`category` and `subcategory` labels on each item; restore rejects a subcategory outside
the item's category. An item's duplicate-detection identity includes both labels.

## Earlier clients and files

- **Requests.** An item request that lists `categoryIds` without `categoryId` comes
  from a page loaded before items had one category. Saving it would unfile the item, so
  it is refused with a message to reload, and the page keeps its draft.
- **Backups.** Every client downloads the current version. Versions 1 and 2 list
  several categories per item; import keeps the first one listed.
- **Browser storage.** The server-data cache and open-item snapshots are schema
  version 4. Readers upgrade a stored list of categories to its first entry, and a clean
  entry stays clean so the upgrade is never saved back as an edit.
