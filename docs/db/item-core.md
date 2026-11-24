# Item core and the text-focused Notes client

An **item** is the workspace-owned persistent unit. A **note** is an item with
nonblank authored text, presented by the current text-focused web client. Adding
future dates, files, contacts, financial information, or task properties will
extend an item without converting it into another exclusive type.

## Identity

Every item and every workspace has two ids. The integer `id` is the primary key and
the target of every foreign key; it stays inside the database and the API calls that
act on a loaded record. The `uid` is a UUID that never changes and is the identity
everything else uses: addresses, backups, and whatever a device keeps
(`contracts/public-uid.ts`).

A create may name the uid of its item. The server stores one item per uid, so a create
that is sent twice stores one item: the second finds the first one's row, writes
nothing, and answers `200` with that item instead of `201`. The caller then sends its
content as an update. A uid held by an item in another workspace or account is refused
with `409` and reveals nothing about that item.

An item keeps its uid when it moves between accounts. A backup carries uids, and a
restore keeps a uid that is free and assigns a new one when an item or workspace
already has it, because that restore is making a second copy.

## Capabilities

[The item model](item-model.md) declares what an item can hold, which combinations are
which kinds, and what a write does. It is data in `contracts/item-model.ts` of
`@lib/db-items`: `contracts/item-capabilities.ts` and `contracts/item-kinds.ts` derive
from it and hold no rule of their own. `GET /api/items/model` serves it without
authentication, and `generated/contracts/item-model.json` is the committed copy, which
`app:contract:generate` writes and `app:contract:check` checks.

Content (text, a time block, a journal day) makes an item exist. State (a schedule, a
status) describes an item and never keeps it alive, and taxonomy organizes content and
is not content. A state can require a capability beside it: a status requires text.
`itemCapabilities(item)` lists the capabilities an item holds. `hasItemContent(item)`
is the first save rule: an item must hold content, so a status, a date, a category, or
tags alone do not make an item. `missingRequirement(item)` is the second: a state is
refused without what it requires. The item service applies both to a new item and to
the result of an update, and check constraints on `workspace_item_v1` repeat them.

No layer names text as the content it expects. Listing, group actions, backup,
restore, account merge, and the trash carry an item whatever it holds; text search and
embeddings skip an item without text.

An item without content is not kept. The service refuses to store one, and the web
client deletes a stored item when an edit removes its content: emptying a note or a task
that has no time block deletes it, whatever status or date it has, and the item goes to the [trash](#trash) as
it was last stored. Deleting a status clears it from its items and deletes none of them.

### Stored capabilities

`sql/item/stored-capabilities.ts` is the server half of the registry. For identity,
taxonomy, and each capability it declares the item columns and tables it owns, its
fields in a backup item, how each field is exported and imported, whether it counts
toward duplicate detection, and how a column that points into the item's workspace is
re-pointed when the item moves to another workspace.

A table that belongs to items cannot be declared on its own. Its entry names the backup
field that reads its rows and gives the statement that writes them on restore, so
owning a table always includes backing it up. A table whose rows also point into the
workspace, as tag links do, adds how those rows are detached and attached again when
the item moves; a table keyed only by item id needs nothing, because the item keeps its
id. Rows in a retired table are deleted when their item moves.

Four things are generated from those declarations and list no item column themselves:

- **Backup export and import** (`sql/user/backup.ts`).
- **Duplicate detection** on restore (`sql/user/item-merge-identity.ts`): every
  declared field except the modification time.
- **Account merge** (`sql/user/anonymous.ts`): items are moved, not copied. An item
  keeps its id, timestamps, and derived data, so a table keyed by item id follows it
  with no merge code.
- **The storage audit** (`scripts/audit-item-storage.ts`, run by `db:verify`): it fails
  on a column of `workspace_item_v1`, or a table with a foreign key to it, that no
  declaration accounts for; on a backup field that restore writes nowhere (it needs an
  `import`, or a table that restores it); and on an owned table whose rows point into
  the item's workspace but that declares no `rehome`.

Adding a capability means adding its entry there and in the item model. A
backup version increases whenever a field is added, and import reads every earlier
version.

## Time blocks

A time block is `time_start` and `time_end` on an item, set together and in order; they
may be the same instant. `normalizeTimeBlock` (`contracts/item-time.ts`) fills in the
one a request leaves out from the other, in the HTTP parser, the item service, and the
backup reader. A block may lie in the past or the future; nothing stored says which.

A write request that names neither `timeStart` nor `timeEnd` says nothing about the
time block: a create stores none, and an update leaves the stored one as it is. Sending
`null` removes it.

A time block is content, so an item can be one without text. It is then of the `time`
kind only, takes no status, and has no embedding.

## Journal entries

A journal entry is an item with an `entry_date`: a calendar date with no time or zone,
read and written as `YYYY-MM-DD`. It is content, so an entry needs no text. A workspace
has one entry per day, kept by the unique index `workspace_item_v1_journal_day_key`.

Like every field of an update, `entryDate` left out is left as stored, and `null`
removes it. A write that would give a workspace a
second entry for a day is refused with `409` (`JournalDayTakenError`). What happens
next is the caller's choice, because combining two days is permanent:

| Situation                                    | Outcome                                                           |
| -------------------------------------------- | ----------------------------------------------------------------- |
| An item is given a day another entry has     | Refused. `POST /api/items/journal` combines it into that entry.   |
| A trashed entry is restored onto a taken day | Refused and left in the trash, unless `combineJournalDay` is set. |
| An entry moves to a workspace with its day   | Refused.                                                          |
| Account merge or backup restore meets a day  | Combined without asking, since no one can be asked.               |

Combining (`sql/item/journal.ts`) appends the text after the remaining entry's own,
unless that entry already holds it, as when one backup is restored twice,
adds the tags it lacks, and keeps its filing and everything else it holds. The entry
combined into it is deleted without going to the trash, because its text now lives in
the other. When its text changed, the remaining entry's [embedding](#embeddings) is
cleared and written again.

A backup file that names one day twice in a workspace is refused.

## Updates

`POST /api/items` takes a whole item (`ItemInput`): a field it leaves out is empty.
`PATCH /api/items` takes a patch (`ItemPatch`): a field absent from `item` is left as
stored, `null` clears it, and `tagIds: []` removes every tag. `workspaceId` is optional
in a patch and must name the item's workspace when given; an update never moves an
item.

The service locks the item row, merges the patch into it, and applies the save rules to
the result (`sql/item/update.ts`). A result with no content is refused with
`content_required`, and a state without what it requires with `requirement_missing`.
A category named without a subcategory keeps the stored subcategory only while it
belongs to that category.

## Concurrent edits

An update may name the version it edited: `expectedTimeModified`, the `timeModified` of
the item as the caller last saw it. Every change to an item moves `time_modified`, so
it identifies a version; an embedding write is not a change and leaves it alone. When
the stored item has moved on, the update writes nothing and answers `409 item_changed`
with the stored item (`ItemConflictResponse`). An update that names no version is
applied over whatever is stored.

The web editor names the version for every open entry, and the time view's form names
it for the block it changes. On a `409` the save engine compares the stored item with
what the entry last saved, what the page sent as it was hidden, and what it is sending
now. If any of them matches, nothing changed that the user did not write here, and the
save is sent again from the stored version. Otherwise the entry keeps its draft and a
notice shows the stored text and offers saving the user's version over it. List actions
send only the fields they change and name no version; neither does an entry that left
the open ring or the request sent as the page closes.

## Embeddings

A write never waits on the embedding provider. A new item, or one whose text changed,
is stored with `description_embedding`, `embedding_model`, and `embedding_updated_at`
empty. The route handler calls `embedItemForItemsApp` after the response is sent, for a
create, an update, a trash restore, and a journal combine. When the provider fails the
item stays without an embedding, search does not rank it, and
`POST /api/items/maintenance/embeddings` writes it later.

An embedding is stored only while the item still holds the text that was embedded, and
storing it keeps `time_modified` as it is (`updateItemEmbeddingsForUser`). Category and
tag labels are stored without an embedding, and a rename clears it; only maintenance
writes label embeddings. `JINA_API_KEY` is therefore needed for search and embedding
maintenance, not for saving.

## Trash

Every deletion of an item, single or as part of a group action, moves it to
`user_item_trash_v1` in the same statement (`TRASH_ITEMS_SQL`). A trash entry is not an
item: it holds the item's backup fields as JSON, built from the stored-capability
registry, so a new capability is kept in the trash without any trash code. Nothing that
lists, counts, searches, moves, or backs up items sees it.

Deleting or moving items removes the categories, subcategories, and tags no item uses
any more (`sql/workspace-cleanup.ts`). Statuses are kept, and so is a workspace left
with no items: only the user deletes a workspace. The trash belongs to the user, not
the workspace, so it outlives a deleted workspace: an entry remembers its workspace by
id while that exists and by label after.

| Action                | Route                                  | What happens                                            |
| --------------------- | -------------------------------------- | ------------------------------------------------------- |
| List                  | `GET /api/items/trash?before=<cursor>` | A page of 200 entries, newest first, with `nextCursor`. |
| Restore               | `POST /api/items/trash`                | The entry becomes an item again and leaves the trash.   |
| Delete forever, empty | `DELETE /api/items/trash`              | One entry, or all of them, is removed for good.         |

`before` is the `nextCursor` of the previous page. The cursor names a place in the order,
not an entry, so the next page is found after entries of the last one were restored or
purged. The list also answers `hasMore` and `retentionDays`.

Restoring is an import of one item (`sql/item/trash.ts`). It goes to the workspace it
was deleted from, or the user's workspace of the same label, which is created when
there is none. The category, subcategory, status, and tags it names are created when
they are missing. It keeps its uid unless an item took that uid meanwhile, and its
creation and modification times. It gets a new integer id and no embedding, which is
written [after the response](#embeddings).

An entry is kept for `TRASH_RETENTION_DAYS` (30, exported from
`contracts/item-model.ts`). Every listing and every deletion first removes the user's
entries older than that. Account merge moves a visitor's trash to the account. A
backup carries no trash.

## Deleting a workspace

`DELETE /api/workspaces` takes `{ workspaceId, confirmation: "delete-workspace",
expectedItemCount? }` (`sql/workspace-delete.ts`). The workspace's items go to the trash
first, and its categories, statuses, and tags are removed with it. `expectedItemCount`
is the number of items the caller reviewed: when the workspace holds a different number,
nothing is deleted and the answer is `409`. Any workspace can be deleted, and deleting an
account's last one leaves a fresh `personal` workspace to capture into.

In the web client, the workspace picker has a delete button beside each workspace. A
workspace with no items is deleted at once. One that holds items first opens a dialog
that lists them (`DeleteWorkspaceModal`).

Deleting one item runs in a repeatable-read transaction. A serialization failure is
tried again, up to three attempts, before the request answers `409`.

## Kinds

A kind names what an item holds. It is computed from the item every time and never
stored, so it cannot disagree with the content. An item can be several kinds at once,
and it stops being a kind when the content that made it one is removed. The kinds are
`note`, `task`, `time`, and `journal`; [the item model](item-model.md) lists what each
holds. Kind names are lowercase and singular, and the views use them as labels.

`itemKinds(item)` lists an item's kinds and `isKind(item, key)` tests one
(`contracts/item-kinds.ts`). `notes-next` keeps every item of the workspace, and each
view declares which of them it lists in terms of kinds: the `task` view lists tasks,
and the `note` view lists everything with text except the kinds the user left out of
it. `isTextItem` is the `note` test for code that also needs the item narrowed to its
text.

## Package and naming

The package is `@lib/db-items` in `lib/db-items`. Shared records, services, SQL,
generated contracts, and generic client state use item terminology. The web app is
`notes-next`, and its text capture UI says note.

Items are rows of `workspace_item_v1`, whose id sequence is named
`user_note_v1_id_seq`. Category, status, and tag vocabulary is workspace-scoped, and
composite foreign keys reject cross-workspace relationships. `description` is
nullable. There is no exclusive item type.

An item is filed in at most one category and one subcategory of that category; see
[item taxonomy](item-taxonomy.md). Category, subcategory, and uncategorized
navigation groups share transactional bulk actions; see
[item group actions](item-group-actions.md) for selection, rename/deletion, preview
conflict handling, and client coordination.

## API contracts

Data routes are under `/api/items`; [the item API](../../lib/db-items/contracts/items-api.md)
lists them. Payloads use `item`, `items`, `itemId`, `itemCount`, `itemsImported`, and
`itemsSkipped`. Item text is nullable in storage and in payloads. The acting user comes
from the session cookie or a bearer token, never from a user id in the request.

The item, trash, journal, search, embedding maintenance, item-group, session,
vocabulary, and workspace routes go through one wrapper (`route()` in
`apps/notes-next/app/api/_lib/items-app-route-handlers.ts`), so their authentication
and error answers are the same and each answer carries `Cache-Control: no-store`. An
error body is `{ error, code }`: a sentence for a person and one of the `ErrorCode`
values of `contracts/items-app.ts` for a program (`describeItemsAppError`). A stale
update adds the stored `item`. The service throws `InvalidRequestError`
(`contracts/request-error.ts`), or a subclass, for a request it refuses. Any other error
is a server fault: it answers `500 internal` with a generic message and is logged on the
server. Bootstrap and backup have their own handlers and answer the same body.

## Stored formats and environment

- Backup files are version 5: subcategories nest under categories, an item has one
  category, and items carry time blocks and journal days. Every client downloads
  version 5. Import also reads version 4, which has no journal days, version 3, which
  has no time blocks either, version 2's category lists, keeping the first category,
  and version 1's `workspaces[].notes`. An item of versions 1 to 3 that holds no
  content is left out, and a status on an item without text is dropped.
- Open-item storage in the browser is schema version 4. Its reader upgrades versions 1
  to 3, including the `notes-open-notes-v1` and `notes-open-notes-v2` keys, and keeps
  authored text, navigation keys, and each entry's clean or dirty state.
- The browser's copy of server data is version 7 and requires a uid on every item. A
  snapshot in another shape is ignored, and the next load fetches a fresh one.
- A session stores the user id as `itemsUserId`. `readItemsUserId`
  (`apps/notes-next/src/lib/sessionIdentity.ts`) also reads `notesUserId` from a cookie
  that names it that way. Text-client preferences live in the `notesApp` namespace.
- `DB_ITEMS_URL` and `DB_ITEMS_TEST_URL` name the database. `DB_NOTES_URL` and
  `DB_NOTES_TEST_URL` are read when those are unset. Tests connect only to an explicit
  test URL.

## Verification

Administrative SQL backups use the table list in `scripts/db/common.sh`. They include
owned sequence values and the vector and timestamp-function dependencies the tables
need. Each restore command is transactional and refuses to cascade into unselected
tables. Schema and data files are separate steps; see
[the backup runbook](../../scripts/README.md) for the exact guarantees. Portable user
backups are the separately versioned JSON format described above.

Run `pnpm run db:migrate` and `pnpm run db:verify` against an isolated database,
`DB_ITEMS_TEST_URL=... pnpm --filter @lib/db-items test`, and
`pnpm run release:notes:prepare`. `db:verify` asserts that the note-named views
`user_note_v1`, `user_note_tag_link_v1`, `workspace_note_category_v1`,
`workspace_note_status_v1`, and `workspace_note_tag_v1` are absent. Keep generated
artifacts committed, and do not apply migrations to a deployed database without the
task's authorization.
