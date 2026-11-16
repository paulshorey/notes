# Item core and the text-focused Notes client

An **item** is the workspace-owned persistent unit. A **note** is an item with
nonblank authored text, presented by the current text-focused web client. Adding
future dates, files, contacts, financial information, or task properties will
extend an item without converting it into another exclusive type.

## Capabilities

`contracts/item-capabilities.ts` in `@lib/db-items` is the registry of what an item can
hold beyond identity, workspace, and taxonomy:

| Capability | Stored as                      |
| ---------- | ------------------------------ |
| `text`     | `description`                  |
| `schedule` | `time_due`, `time_remind`      |
| `status`   | `status_id` → workspace status |

Every capability is optional and none is required. `itemCapabilities(item)` lists the
capabilities an item holds. `hasItemContent(item)` is the save rule: an item must hold
at least one capability, so a date or a status alone makes an item, and categories and
tags alone do not, because taxonomy organizes content and is not content. The item
service applies the rule on create and update. The tables accept a bare item.

No layer below the Notes screen requires text. Listing, group actions, backup, restore,
and account merge carry an item without text; text search and embeddings skip it.
Requiring text is a rule of the Notes view alone (its `canSave` in the `notes-next`
view registry), because that view captures nothing else.

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

## Kinds

`contracts/item-kinds.ts` names what an item holds. A kind is computed from the item
every time and never stored, so it cannot disagree with the content. An item can be
several kinds at once, and it stops being a kind when the content that made it one is
removed.

| Kind   | An item is this kind when it holds  |
| ------ | ----------------------------------- |
| `note` | text                                |
| `task` | a status, a due date, or a reminder |

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
in payloads; the item service refuses to save only an item that holds no capability.

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
- Browser cache and open-item storage use version 4. Readers upgrade note-named
  and category-list snapshots, including serialized IDs and clean/dirty signatures.
  Authored text and navigation keys are preserved. Legacy dirty snapshots are
  not removed if the upgraded snapshot cannot be written.
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
