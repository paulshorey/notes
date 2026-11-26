# The item model

One record, the item, is a note, a task, a time block, a journal entry, or several of
these at once. Nothing stored says which. This guide explains how that is decided and
what each write does.

The rules are data, declared once in
[`lib/db-items/contracts/item-model.ts`](../../lib/db-items/contracts/item-model.ts):

| Reader                | How it gets the model                                         |
| --------------------- | ------------------------------------------------------------- |
| The item service      | `assertItemHasContent` reads the declarations on every write. |
| Views in `notes-next` | `isKind` and `itemKinds` read the same declarations.          |
| A script or an agent  | `GET /api/items/model`, which needs no sign-in.               |
| A reviewer, or a diff | `lib/db-items/generated/contracts/item-model.json`.           |

`pnpm --filter @lib/db-items app:contract:generate` rewrites the JSON file, and the
app's type check and build fail when it is out of date.

## Capabilities

A capability is one thing an item can hold. Content makes an item exist. State
describes an item and never keeps it alive.

| Capability | Role    | Fields                  | Held when             | Requires |
| ---------- | ------- | ----------------------- | --------------------- | -------- |
| `text`     | content | `description`           | the text is not blank |          |
| `time`     | content | `timeStart`, `timeEnd`  | a start is set        |          |
| `day`      | content | `entryDate`             | a day is set          |          |
| `schedule` | state   | `timeDue`, `timeRemind` | either is set         |          |
| `status`   | state   | `statusId`              | a status is set       | `text`   |

Filing (`categoryId`, `subcategoryId`, `tagIds`) is taxonomy. It is neither content nor
state, and it makes no kind.

Two rules follow, and every write is checked against them:

- **An item holds content.** A status, a date, a category, or tags alone are not an item.
- **A state has what it requires.** A status needs text beside it.

## Kinds

A kind is a name for a combination of capabilities. It is computed every time and never
stored, so it cannot disagree with the item.

| Kind      | The item holds      |
| --------- | ------------------- |
| `note`    | `text`              |
| `task`    | `text` and `status` |
| `time`    | `time`              |
| `journal` | `day`               |

An item is every kind it matches. Text with a status and a time block is a note, a
task, and a time item, and it appears in each of those views as the same item.

## What a write does

**Create** (`POST /api/items`) takes a whole item; a field it leaves out is empty. It
is refused without content. It may name the item's `uid`: repeating the create stores
nothing and answers `200` with the stored item instead of `201`.

**Update** (`PATCH /api/items`) takes a patch.

| In the patch        | Effect                                    |
| ------------------- | ----------------------------------------- |
| A field is absent   | It stays as stored.                       |
| A field is `null`   | It is cleared. `tagIds: []` removes tags. |
| A field has a value | It is written.                            |

The two rules are applied to the item the patch would leave, not to the patch. A patch
that names only `statusId` is valid on an item that has text and refused on one that
has none. `expectedTimeModified` names the version the caller last saw; a stale one
writes nothing and answers `409` with the stored item.

**Delete** (`DELETE /api/items`) sends the whole item to the trash for 30 days. It also
removes each category, subcategory, and tag that no item uses any more. Statuses are
kept, because they are the columns of a workflow, and so is the workspace. An optional
`expectedTimeModified` guards the deletion. A stale version returns the stored item
with `409 item_changed` and leaves it in place.

## Removing one capability

To remove a capability, send its fields as `null`. The `removals` list in the JSON
states this table for each capability.

| Remove     | Send                          | The item stops being | Refused when                                   |
| ---------- | ----------------------------- | -------------------- | ---------------------------------------------- |
| `text`     | `description: null`           | `note`, `task`       | it holds a status, or text is its only content |
| `time`     | `timeStart: null`             | `time`               | the time block is its only content             |
| `day`      | `entryDate: null`             | `journal`            | the day is its only content                    |
| `schedule` | `timeDue`, `timeRemind: null` | nothing              | never                                          |
| `status`   | `statusId: null`              | `task`               | never                                          |

Some examples:

| Item holds               | Patch                                   | Result                          |
| ------------------------ | --------------------------------------- | ------------------------------- |
| text, status             | `{ statusId: null }`                    | A note. No longer a task.       |
| text, status             | `{ description: null }`                 | Refused: `content_required`.    |
| text, status, time block | `{ description: null }`                 | Refused: `requirement_missing`. |
| text, status, time block | `{ description: null, statusId: null }` | A time item only.               |
| text                     | `{ timeStart: "2027-01-03T09:00:00Z" }` | A note and a time item.         |
| time block               | `{ timeStart: null }`                   | Refused: `content_required`.    |

An update never deletes. A caller that wants an item gone when its last content is
removed deletes it, as the web client does when a note is emptied.

## Errors

A refused request answers `{ error, code }`: a sentence for a person and a code for a
program.

| Code                  | Status | Meaning                                                         |
| --------------------- | ------ | --------------------------------------------------------------- |
| `invalid_request`     | 400    | The request is malformed or names something that is not there.  |
| `content_required`    | 400    | The item would hold no content.                                 |
| `requirement_missing` | 400    | A state would lack a capability it requires.                    |
| `unauthenticated`     | 401    | No valid session or token.                                      |
| `not_found`           | 404    | The user has no such item, category, tag, status, or workspace. |
| `conflict`            | 409    | The request collides with stored data, such as a taken name.    |
| `item_changed`        | 409    | `expectedTimeModified` is stale. The body carries `item`.       |
| `journal_day_taken`   | 409    | The workspace already has an entry for that day.                |
| `search_unavailable`  | 503    | The embedding provider did not answer.                          |
| `unavailable`         | 503    | The database did not answer.                                    |
| `internal`            | 500    | A server fault. Its detail is in the server log.                |

## Adding to the model

1. Add the column in a migration, and declare it in
   `lib/db-items/sql/item/stored-capabilities.ts` so backup, restore, merge, and the
   trash carry it. `db:verify` fails on a column nothing declares.
2. Add the field, capability, or kind to `item-model.ts`.
3. Add the field to `ItemInput`, `ItemPatch`, and `ItemRecord` in
   `contracts/items-app.ts`, to `parseNamedFields` in `sql/item/parse.ts`, and to the
   insert and update statements in `sql/item/add.ts` and `sql/item/update.ts`. The
   update writes only the columns a patch names.
4. Regenerate with `pnpm --filter @lib/db-items db:sync`.
