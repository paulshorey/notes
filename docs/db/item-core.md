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

`contracts/item-capabilities.ts` in `@lib/db-items` is the registry of what an item can
hold beyond identity, workspace, and taxonomy. Each capability has a role.

| Capability | Role    | Stored as                      |
| ---------- | ------- | ------------------------------ |
| `text`     | content | `description`                  |
| `schedule` | state   | `time_due`, `time_remind`      |
| `status`   | state   | `status_id` → workspace status |

Content makes an item exist. State describes an item and never keeps it alive, and
taxonomy organizes content and is not content. `itemCapabilities(item)` lists the
capabilities an item holds. `hasItemContent(item)` is the save rule: an item must hold
content, so a status, a date, a category, or tags alone do not make an item. The item
service applies the rule on create and update. The tables accept a bare item.

No layer below the service names text as the content it expects. Listing, group
actions, backup, restore, and account merge carry a stored item whatever it holds; text
search and embeddings skip an item without text.

An item without content is not kept. The service refuses to store one, and the web
client deletes a stored item when an edit removes its content: emptying a note or a task
deletes it, whatever status or date it has, and the item goes to the [trash](#trash) as
it was last stored. Deleting a status clears it from its items and deletes none of them.

Content types use lowercase, singular names. `note` and `task` are computed from
the capabilities an item holds. An item can match both types. The type names
live in the shared kind registry and are used as the view labels.

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

Adding a capability means adding its entry there and in the browser-safe registry. A
backup version increases whenever a field is added, and import reads every earlier
version.

## Trash

Every deletion of an item, single or as part of a group action, moves it to
`user_item_trash_v1` in the same statement (`TRASH_ITEMS_SQL`). A trash entry is not an
item: it holds the item's backup fields as JSON, built from the stored-capability
registry, so a new capability is kept in the trash without any trash code. Nothing that
lists, counts, searches, moves, or backs up items sees it.

The trash belongs to the user, not the workspace, because deleting a workspace's last
item removes the workspace and the vocabulary nothing else uses. An entry remembers its
workspace by id while that exists and by label after.

| Action                | Route                     | What happens                                          |
| --------------------- | ------------------------- | ----------------------------------------------------- |
| List                  | `GET /api/items/trash`    | The user's 200 most recent entries, newest first.     |
| Restore               | `POST /api/items/trash`   | The entry becomes an item again and leaves the trash. |
| Delete forever, empty | `DELETE /api/items/trash` | One entry, or all of them, is removed for good.       |

Restoring is an import of one item (`sql/item/trash.ts`). It goes to the workspace it
was deleted from, or the user's workspace of the same label, which is created when
there is none. The category, subcategory, status, and tags it names are created when
they are missing. It keeps its uid unless an item took that uid meanwhile, and its
creation and modification times. It gets a new integer id, and its text is embedded
again; if the provider is unavailable, embedding maintenance picks it up.

An entry is kept for `TRASH_RETENTION_DAYS` (30). Each deletion removes the user's
entries older than that. Account merge moves a visitor's trash to the account. A
backup carries no trash, and deleting a workspace deletes its items without trashing
them.

## Kinds

`contracts/item-kinds.ts` names what an item holds. A kind is computed from the item
every time and never stored, so it cannot disagree with the content. An item can be
several kinds at once, and it stops being a kind when the content that made it one is
removed.

| Kind   | An item is this kind when it holds |
| ------ | ---------------------------------- |
| `note` | text                               |
| `task` | text and a status                  |

`itemKinds(item)` lists an item's kinds and `isKind(item, key)` tests one. Each kind is
the selection rule of one view: `notes-next` keeps every item of the workspace and each
view lists the items of its kind. `isTextItem` is the `note` test for code that also
needs the item narrowed to its text.

## This refactor

The canonical package is `@lib/db-items` in `lib/db-items`. Shared records,
services, SQL, generated contracts, and generic client state use item terminology.
The web app remains `notes-next`, with the same note editor, autosave behavior,
categories, statuses, tags, authentication, and user-facing wording.

`workspace_item_v1` is the former `user_note_v1` table, renamed in place. Existing
integer IDs, text, timestamps, dates, vectors, vocabulary IDs, and relationships
are preserved. Category/status/tag vocabulary is workspace-scoped, and composite
foreign keys reject cross-workspace relationships. `description` is nullable.

An item is filed in at most one category and one subcategory of that category; see
[item taxonomy](item-taxonomy.md). Category, subcategory, and uncategorized
navigation groups share transactional bulk actions; see
[item group actions](item-group-actions.md) for selection, rename/deletion, preview
conflict handling, and client coordination.

This change does not introduce exclusive item types, split text into a companion
table, add UUIDs/revision checks, change scheduling, or implement attachments,
money, contacts, tasks, project management, or agent workflows. Those are separate
design and implementation steps. Text can become a companion capability later
without changing the meaning of the item identity established here.

## Canonical contracts

New data routes are `/api/items`, `/api/items/search`, and
`/api/items/maintenance/embeddings`. Payloads use `item`, `items`, `itemId`,
`itemCount`, `itemsImported`, and `itemsSkipped`. Item text is nullable in storage and
in payloads; the item service refuses to save an item that holds no content.

The web client sends `X-Items-Contract: 2` on shared routes such as bootstrap,
vocabulary, and backup. A request that names a contract gets the item payload; a
shared route with no contract also includes note-named field aliases. The
`/api/notes` compatibility facade translates old requests and responses at the
HTTP boundary; it calls the same authenticated item service and database rows.
Compatibility never makes a client-supplied user ID authoritative.

## Existing data and clients

- Forward migration `202610201800__rename_notes_to_items.sql` renames physical
  tables, columns, constraints, indexes, vocabulary sequences, and triggers.
  Immutable earlier migration files are moved with the package unchanged.
- Five simple, automatically updatable views retain the old SQL table names
  while old servers drain. They expose the same rows, including old `note_id`
  column names on link views. They are excluded from generated canonical types.
- The single existing `user_note_v1_id_seq` keeps its name temporarily because
  old account-merge SQL calls it literally. New code discovers the owning
  sequence with `pg_get_serial_sequence`; no competing allocator is created.
- Backup version 3 nests subcategories and stores one category per item. Import
  accepts version 2's category lists and version 1's `workspaces[].notes`, with the
  reserved-category conversion. Every client downloads version 3.
- Open-item storage uses version 4. Its reader upgrades note-named and category-list
  snapshots, including serialized IDs and clean/dirty signatures. Authored text and
  navigation keys are preserved. Legacy dirty snapshots are not removed if the upgraded
  snapshot cannot be written.
- The browser's copy of server data uses version 5 and requires a uid on every item.
  It is never upgraded: a snapshot in another shape is ignored, and the next load
  fetches a fresh one.
- Existing encrypted cookies with `notesUserId` remain valid. Sessions expose
  both identity fields during the transition. The `notesApp` preference namespace
  and its `maxOpenNotes` setting intentionally remain text-client preferences.
- Existing URLs, anonymous merge-token storage, app identity, service names,
  secrets, database names, and embedding model signature remain stable.

## Operations and rollout

`DB_ITEMS_URL` and `DB_ITEMS_TEST_URL` are canonical. Existing `DB_NOTES_URL` and
`DB_NOTES_TEST_URL` remain supported; tests only use an explicit test URL. Do not
apply migrations manually to a deployed database without the task's authorization.

The `@lib/db-notes` package contains only forwarding commands so already-applied
Railway pre-deploy settings continue to migrate the renamed package. The IaC file
declares the new package command and both package watch paths while preserving
the existing `notes` partial, exact service names, and deployed variable keys.
Changing source does not apply Railway settings.

Remove old views, the old sequence name, the command adapter, and legacy payloads
only in a later rollout after proving all old SQL writers and clients have drained
or their support window has ended. Removing compatibility is not part of this PR.

## Verification

Administrative SQL backups use the canonical table list in `scripts/db/common.sh`.
They include owned sequence values, item compatibility views, and required vector
and timestamp-function dependencies. Each restore command is transactional and
refuses to cascade into unselected tables. Schema and data files are separate
steps; see [the backup runbook](../../scripts/README.md) for the exact guarantees.
Portable user backups remain the separately versioned JSON format described above.

Run `pnpm run db:migrate` and `pnpm run db:verify` against an isolated database,
`DB_ITEMS_TEST_URL=... pnpm --filter @lib/db-items test`, and
`pnpm run release:notes:prepare`. Keep generated artifacts committed.

Regression coverage includes a populated pre-rename database upgraded through the
real forward migration, table identity and exact row preservation, old/new writes
sharing one ID sequence, vocabulary upserts through compatibility views, nullable
text persistence, version-one backups, legacy API authentication, signed-session
identity, and browser draft/signature migration. Local checks establish compatibility,
not deployment or live production acceptance.
