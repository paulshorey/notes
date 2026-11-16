---
name: Extensible item core — one item, any content, many kinds
overview: An item is identity, workspace, and taxonomy (one category, one subcategory, any tags). Everything a user adds to it (text, a date, a board status, files, money) is a capability declared once in a registry. A kind such as note, task, media, or spend is a computed name for what an item holds, an item can be several kinds at once, and each kind gets its own view over the same items. The steps correct the taxonomy to one category per level, open the save rule so no layer below the Notes screen requires text, make account merge and backup safe for any content, split the client into a shell plus capability and view modules, and then ship a Tasks board and files to prove the structure.
todos:
  - id: kinds_and_save_rule
    content: "S1. Kind registry (note, task) beside the capability registry; the service accepts any item that holds at least one capability; requiring text becomes a rule of the Notes screen only."
    status: completed
  - id: taxonomy_single_category
    content: "S2. One category and one subcategory per item: workspace_subcategory_v1, category_id and subcategory_id on the item, item contract 2, backup version 3, nested sidebar and two-level picker."
    status: completed
  - id: taxonomy_reorganize
    content: "S3. Reorganize actions in the group engine: move a subcategory to another category, make a subcategory a category, and move a category into another as its subcategory."
    status: completed
  - id: taxonomy_remove_links
    content: "S3b. Drop the category link table, its legacy view, and the earlier item contract shapes, once every environment runs S2."
    status: completed
  - id: capability_safe_lifecycle
    content: "S4. Account merge and restore move item rows instead of copying them; backup and duplicate detection read the registry; db:verify fails on an item table no capability declares."
    status: completed
  - id: shell_and_modules
    content: "S5. An app shell around views: a workspace provider composed of hooks (save engine, open-item ring, session, taxonomy), a view registry with Notes as its first entry, and one client module per capability that the draft, dirty check, and save request are built from."
    status: completed
  - id: tasks_view
    content: "S6. Tasks view: a board by status and a list by due date over the same items, with no new storage. An item with text and a status shows in Notes and in Tasks."
    status: completed
  - id: public_identity
    content: "S7. Add a permanent uid (UUID) to items and workspaces as the public identity, client-generated on create so a retried create is harmless. Integer ids stay as internal keys."
    status: completed
  - id: files_capability
    content: "S8. Files as the first capability with new storage, built only through the extension points: item_file_v1, the service's per-capability validate and write hooks, upload and download on the media bucket, backup with bytes, a client module, and the media and voice memo kinds."
    status: pending
  - id: lossless_input
    content: "L1–L3. Independent small releases: store item text as typed; add normalized label keys that carry uniqueness; stop lowercasing labels."
    status: pending
isProject: true
---

# Extensible item core

## 1. Goal

`jot.new` lets anyone open a browser and add something without deciding what it is or
where it goes: type, talk, drop a file, enter a price, pick a date. What they add becomes
an item. Later they add more to that same item and organize it. The item's meaning grows
with its content, and nothing stored earlier is rewritten or lost when a new kind of
content ships.

This plan makes two changes local: adding a kind of content (one table, one registry
entry, one client module) and adding a view over a kind (one registry entry, one route).
It then proves both by shipping a Tasks view and files.

## 2. The model

**Item.** `workspace_item_v1`: identity, one workspace, taxonomy pointers, timestamps.
No type column. No content is required by the table.

**Taxonomy.** Where an item is filed. It is the same for every kind of content:

| Level       | Cardinality per item | Stored as                                     |
| ----------- | -------------------- | --------------------------------------------- |
| Workspace   | exactly one          | `workspace_id`                                |
| Category    | at most one          | `category_id` → `workspace_category_v1`       |
| Subcategory | at most one          | `subcategory_id` → `workspace_subcategory_v1` |
| Tags        | any number           | `item_tag_link_v1`                            |

A subcategory belongs to exactly one category, and an item's subcategory must belong to
the item's category. Category and subcategory are optional, so an item can be jotted
first and filed later; an item with no category displays under `uncategorized`.
Taxonomy never counts as content.

**Capabilities.** Everything an item holds. Each is optional and independent:

| Capability | Stored as                      |
| ---------- | ------------------------------ |
| `text`     | `description` column           |
| `schedule` | `time_due`, `time_remind`      |
| `status`   | `status_id` → workspace status |

`contracts/item-capabilities.ts` in `@lib/db-items` is the registry. Section 4 lists the
capabilities this structure is designed to take next.

**Kinds.** A kind is a name for what an item holds. It is computed from the item every
time and never stored, so it cannot disagree with the content. An item can be several
kinds at once, and it stops being a kind when the content that made it one is removed.

| Kind         | An item is this kind when it holds       | Ships in |
| ------------ | ---------------------------------------- | -------- |
| `note`       | text                                     | S1       |
| `task`       | a status, a due date, or a reminder      | S1       |
| `media`      | an image or video file                   | S8       |
| `voice memo` | an audio file                            | S8       |
| `spend`      | an amount, or a file marked as a receipt | later    |

A photo with a caption and a due date is media, a note, and a task.

**Views.** Each kind gets a view: Notes, Tasks, Media, Spend. A view lists the items of
its kind inside the current workspace and taxonomy selection, and offers the capture and
editing controls suited to that kind. The same item appears in every view whose kind it
is. Opening it anywhere opens the same item.

**Save rule.** An item is saved when it holds at least one capability. The tables, the
service, backup, merge, and search accept an item without text. Requiring text is a rule
of the Notes screen alone, because that screen has nothing else to capture.

## 3. Extension points

These checklists define "extensible". Each step in section 5 exists to make one of their
lines true.

### Adding a capability

1. **Storage.** One value per item: a nullable column. Many values per item, or values
   with their own identity: a table `item_<name>_v1` with
   `item_id REFERENCES workspace_item_v1(id) ON DELETE CASCADE`. The table also carries
   `workspace_id`, with composite foreign keys to both sides, only when it references a
   second workspace-owned row, so the database rejects a link across workspaces. Rows
   addressed from outside get a `uuid` key.
2. **Registry entry**, in two halves with the same key. The browser-safe half in
   `contracts/item-capabilities.ts` says how to tell the capability is present. The
   server half says how it is validated, written, exported, imported, and compared.
3. **Nothing else on the server.** Delete cascades. Account merge moves the item row, so
   its tables follow (S4). Backup and duplicate detection iterate the registry (S4).
4. **One client module** in `apps/notes-next/src/capabilities/`: a draft part (its
   form fields, how a stored item fills them, what a save sends, when it is blank, and
   its list label) and an editor control. The draft, the dirty check, and the save
   request are composed from the parts, so adding the part to the list is the only
   edit outside the module. A capability captured by a gesture, such as a dropped
   file, adds its capture handler here.

### Adding a kind and its view

1. **Kind entry** in `contracts/item-kinds.ts`: key, label, and a predicate over the item.
2. **View entry** in `apps/notes-next/src/views/registry.ts`: kind, route, label, and
   `canCreate`, the view's rule for starting an item from a draft (Notes starts a note
   once it has text). Its page goes under `app/(workspace)/`, inside the shared shell. A view with a
   quick-add also declares the defaults it applies (the Tasks board adds an item with
   that column's status).

### Hooks

Type-specific logic attaches to the registries instead of branching in the item service:

| Hook                           | Runs                                         | First user                                            |
| ------------------------------ | -------------------------------------------- | ----------------------------------------------------- |
| `validate`, `write`            | inside the save transaction, per capability  | S8 (file rows)                                        |
| `afterCommit`                  | after a save commits, per changed capability | S8 (thumbnails); later transcripts, reminder delivery |
| `canCreate` (view)             | when the save engine considers a new draft   | S5 (Notes requires text)                              |
| `export`, `import`, `identity` | backup, restore, duplicate detection         | S4                                                    |
| `quickAddDefaults`             | when a view creates an item                  | S6                                                    |
| `onEnter`, `onLeave` (kind)    | after a save changes an item's kinds         | added with the first feature that needs one           |

A hook is added in the step that has its first user, never ahead of one.

### A view owns the rules for edits made in it

- Logic specific to a kind (what is worth saving, quick-add defaults, checks beyond the
  storage rule) lives in that kind's client view. The server validates and stores
  capabilities and knows nothing about kinds or views.
- An item that is also a task is edited in Notes exactly like any other note: Notes
  changes its text and taxonomy. Logic that belongs to Tasks, media, or spend never
  runs for an edit made in Notes.
- A view favors the parts of an item it is about. Its editor shows those parts up
  front and keeps the others reachable in a menu, so opening one item from two views
  gives two emphases over the same content: Notes favors filing and tags, Tasks
  favors status and dates.
- Content is additive. A save from a simpler view carries the item's other content
  through unchanged, and a view never has to understand a capability it does not show.
- A view decides what it starts. Whether a new draft becomes an item is the rule of
  the view it was written in: Notes starts a note from text, Tasks starts a task from
  any content. A draft pending under one view is saved before another view takes it.
- Once an item is stored, its edits are saved from every view, and the views agree on
  what is stored. What you see is what is saved.
- An item without content is not kept. It cannot be saved, and a stored item whose
  last content is removed is deleted. Filing and tags organize content and are not
  content, so an item holding only those is empty.
- An entry with nothing to save never blocks anything. Session changes, workspace
  switches, backups, and group actions wait only for entries that have a save to
  send, and are refused only when one of those saves fails.

### Rules that keep this true

- Never repurpose a column or give a stored value a second meaning.
- Store what the user meant: text as typed, labels as typed plus a key, money as integer
  minor units plus currency, original file bytes plus metadata.
- Derived data (embeddings, thumbnails, transcripts, link previews) is rebuildable and
  never in backups.
- Derived data may suggest content (an amount read from a receipt, a due date read from
  "tomorrow 3pm", a category). A suggestion is applied only when the user accepts it.
- File storage keys are opaque UUIDs with no user, workspace, or item id in them, so
  moving an item never touches the bucket.
- New SQL authorizes through one workspace-access helper instead of repeating the
  ownership join.
- A view that removes its own content from an item never removes the item's other
  content. The item is deleted only when the user deletes it or it holds nothing.

## 4. What this is designed to hold

The steps below build only S1–S8. This catalog is the test of the model: each row must
fit the checklists in section 3 without changing the item, the taxonomy, or another
capability.

| Capability  | Holds                                               | Storage                    | Kinds it creates             |
| ----------- | --------------------------------------------------- | -------------------------- | ---------------------------- |
| `files`     | photos, video, audio, documents, receipts, invoices | `item_file_v1` + bucket    | media, voice memo, document  |
| `amounts`   | money in or out, line items, currency               | `item_amount_v1`           | spend, income, invoice       |
| `times`     | events with zone, all-day, recurrence; tracked time | `item_time_v1`             | event, time log              |
| `urls`      | saved web links                                     | `item_url_v1`              | bookmark                     |
| `relations` | parent and child items, related items               | `item_relation_v1`         | project, checklist, thread   |
| `place`     | where it happened                                   | columns or `item_place_v1` | place                        |
| `people`    | who it is about or assigned to                      | `item_person_v1`           | contact, assignment          |
| `publish`   | slug, visibility, publish time                      | `item_publication_v1`      | post, page (website content) |
| `measure`   | a number with a unit (weight, mileage, mood)        | `item_measure_v1`          | log entry                    |
| `fields`    | user-defined properties                             | `item_field_v1`            | user-defined                 |

Ways to add an item, each ending in the same create call with whichever capability the
gesture produced: typing, paste, file drop or picker, camera, microphone, the phone's
share sheet (PWA share target), an email-in address, a text message, a browser
extension, and the token API for scripts and agents.

Views that need no new storage once their kind exists: an inbox of unfiled items, a
calendar of dated items, a gallery, a ledger with totals by category and month, and one
search across every kind.

## 5. Steps

Each step is one PR and one release unless it says otherwise.

### S1. Kinds and the open save rule

- `contracts/item-kinds.ts` declares `note` and `task` with `itemKinds(item)` and
  `isKind(item, key)`. `isTextItem` becomes the `note` predicate.
- The capability registry drops the `content` flag. `hasItemContent` is true when any
  capability is present, so the service accepts an item with only a date or only a
  status and refuses only an item that holds nothing.
- The Notes screen keeps its own rule (a draft is worth saving when it has text) in
  `itemDraft.ts`, separate from the service rule.
- Tests prove every layer handles an item without text: create and update through the
  service, list, search (excluded, no embedding requested), group preview, backup and
  restore, and anonymous merge.

No schema change. The Notes screen behaves as it does today.

### S2. One category and one subcategory per item

Schema, added in one migration:

```sql
CREATE TABLE workspace_subcategory_v1 (
  id, category_id NOT NULL REFERENCES workspace_category_v1(id) ON DELETE CASCADE,
  label, time_created, time_modified,
  UNIQUE (category_id, label), UNIQUE (id, category_id)
);
ALTER TABLE workspace_item_v1
  ADD category_id integer, ADD subcategory_id integer,
  ADD FOREIGN KEY (category_id, workspace_id)
    REFERENCES workspace_category_v1 (id, workspace_id),
  ADD FOREIGN KEY (subcategory_id, category_id)
    REFERENCES workspace_subcategory_v1 (id, category_id) ON UPDATE CASCADE,
  ADD CHECK (subcategory_id IS NULL OR category_id IS NOT NULL);
```

The database guarantees at most one of each per item, that a subcategory belongs to the
item's category, and that both belong to the item's workspace. Two tables make the
depth exactly two by construction, with no triggers. `docs/db/item-taxonomy.md`
describes the result.

- **Backfill.** Every existing category stays a category. An item in several categories
  keeps the oldest-created one; its other memberships are not carried over. The
  backfill leaves item modification times untouched. The link table is left in place
  and unused until S3b.
- **Deleting a category or subcategory** goes through the group engine
  (`sql/item-groups.ts`), which clears or deletes the member items in the same
  transaction before removing the row. The item foreign keys take no delete action, so
  a direct delete of a category in use fails instead of silently unfiling items.
  Deleting a workspace still cascades.
- **Contracts.** `ItemRecord` has `category` and `subcategory` (each a ref or null);
  `ItemInput` has `categoryId` and `subcategoryId`. A subcategory that does not belong
  to the chosen category is cleared. Category payloads nest their subcategories, and
  `POST /api/categories` with a parent `categoryId` creates a subcategory. Group
  targets add `subcategory`.
- **Compatibility.** The client sends `X-Items-Contract: 2`. Any other request keeps
  the array shape for one release: `categories` holds zero or one entry next to the
  current fields, and only the first of `categoryIds` is used.
- **Backup version 3** stores `category` and `subcategory` per item and nests
  subcategories under categories. The importer reads versions 1 and 2 and keeps the
  first listed category.
- **Merge and duplicate detection** copy subcategories and remap `category_id` and
  `subcategory_id` by label, as `status_id` is remapped.
- **Client.** A category picker and, once a category is chosen, a subcategory picker
  beside it; each can create. The sidebar nests subcategories under their category,
  with items filed directly in the category listed first. Open-item and cache snapshots
  are schema version 4 and read the array form.
- A subcategory label has no embedding. Category label embeddings have no reader, so
  the subcategory table does not add another write-only vector.

### S3. Reorganize

One group action, `move`, puts a category or subcategory somewhere else in the
hierarchy and keeps its items in it:

- A subcategory moves to another category. It stays the same row, so its items follow
  through the item foreign key.
- A subcategory moves to the top level and becomes a category with the same label.
- A category moves into another and becomes its subcategory with the same label. This is
  allowed only while it has no subcategories, because the hierarchy is two levels.

Each runs in one transaction with the existing preview and fingerprint, and reports a
label that already exists at the destination as a conflict instead of merging. The
sidebar group menus offer Move, and the dialog names the destination and what the group
becomes before it is sent. A draft that was being filed in a moved group follows it.

### S3b. Remove the link table

`item_category_link_v1` and its legacy view are dropped, along with the earlier item
contract shapes: responses no longer carry a `categories` list, every client downloads
the current backup version, and an item request that lists `categoryIds` is refused with
a message to reload, because saving it would unfile the item. This is the contract half
of S2 and shipped after every environment, production included, ran S2.

Tests of earlier migrations run against the schema as it was just before the migration
under test (`testing/historical-migration.ts`), so they do not depend on tables that
later migrations remove.

### S4. Capability-safe lifecycle

Account merge, backup export, backup import, and duplicate detection are generated from
one declaration per part of an item (`sql/item/stored-capabilities.ts`), so none of them
lists item columns by hand and a new capability cannot be left out of one of them.

- **Merge moves rows.** An item that merges into a workspace of the same name keeps its
  id. One statement removes its tag links, updates `workspace_id`, re-points
  `category_id`, `subcategory_id`, and `status_id` to the destination's rows of the same
  label, and re-creates the tag links against the destination's tags. Every table keyed
  by `item_id`, and the item's embedding, follow with no code. A workspace whose name is
  new to the account changes owner as a whole. Restore stages a temporary account,
  merges it, and skips an item that already exists identically.
- **Moving is not editing.** The timestamp trigger keeps a row's modification time while
  a transaction sets `app.keep_time_modified`, which the merge does around its moves.
- **Registry-driven backup.** Each part declares its backup fields, how each is exported
  and imported, and whether it counts toward duplicate detection. A table a part owns
  must name the field that exports its rows and the statement that imports them, so a
  table cannot be declared without being backed up. The backup version
  increases whenever the file gains a field, and the importer reads every earlier
  version.
- **Guard.** `db:verify` fails on a column of `workspace_item_v1`, or a table with a
  foreign key to it, that no part declares as its own, as taxonomy, or as derived data.

Tests: an anonymous item with every capability merges into an account with a same-named
workspace and keeps its id, timestamps, embedding, taxonomy, and rows in a table keyed
by its id; a backup of every capability restores into an empty account unchanged; the
audit reports an undeclared column and table.

### S5. App shell and capability modules

The client is a shell around views, so a second view is a registry entry and a page.

- **Shell.** `app/(workspace)/layout.tsx` mounts the workspace provider and `AppShell`
  (header, taxonomy sidebar, dialogs, notifications) once for every view.
- **Workspace.** `useItemsWorkspaceController` composes one hook per concern: shared
  state, sidebar layout, loaded data, the save engine, the open-item ring, the lists,
  the session lifecycle, account actions, and taxonomy actions. Each depends only on
  the hooks before it. Account, workspace, item, and vocabulary data live in
  `workspaceStore`; the ring and the taxonomy selection live in `itemsAppStore`.
- **Save engine and open-item ring** hold no rule about text. The engine asks the
  view's `canCreate` whether a draft becomes an item, and the ring's empty-draft test
  asks each draft part whether it is blank.
- **Capability modules.** Text, schedule, and status each provide a draft part and an
  editor control; filing and tags provide draft parts. Form state, entry signatures,
  the save request, and list labels are composed from the parts. Their order is a
  stored format, pinned by a test, because browsers keep entry signatures.
- **Views.** `views/registry.ts` maps a kind to a route. Notes is the first entry and
  `/` stays the Notes view. The workspace keeps every item it loads, and each view
  lists the items of its kind.

The item service keeps writing the columns of the item row in one statement. Text
embeddings are computed before the save transaction and written in that statement, so
a saved note is searchable as soon as the save returns. Per-capability `validate`,
`write`, and `afterCommit` hooks arrive with the first capability that has rows of its
own (S8).

No behavior change for the user.

### S6. Tasks view

The second view. It adds no storage: `status` and `schedule` are already on every item.

- `/tasks` shows items of kind `task` in the current workspace and tag selection. The
  header's view switcher links to each registered view.
- **Board.** One column per workspace status in `position` order, then a column for
  tasks with a date and no status, shown only when there are some. Dragging a card
  changes its status. Cards order by due date, then last modified.
- **List.** The same items sorted by due date, so overdue items come first.
- **Quick-add** in a status column creates an item with the typed text and that
  column's status, through the view's `quickAddDefaults`.
- A card opens the shared item editor in a dialog over the board, so its text is the
  same text the Notes view edits. An item with text and a status appears in both
  views. The dialog's toolbar shows status and dates; filing and tags are in its menu.
- **A view decides what it creates.** An open entry records the view it was opened
  in, and that view's `canCreate` decides whether its draft becomes an item: Tasks
  starts one from any content, Notes from text. In every view a new draft becomes an
  item only once the user has put something into it; a preset status alone creates
  nothing. Before another view takes an entry over, a pending save is sent first.
- **A stored item's edits are always saved, and an empty item is deleted.** Removing
  the text of an item that still holds a status or a date saves that removal from any
  view: the item leaves Notes and stays in Tasks. An edit that leaves an item with no
  content deletes it, because an item without content is not kept. The open entry
  stays as a draft with the same uid, so typing again creates the item anew.
- A change made from a list (a board drag, a quick-add, a sidebar move) first saves
  the item's open, unsaved edits, so it never overwrites them, and a session change
  waits for it to land.

The save engine changed in this step: it asked the view on screen which drafts to save,
and now asks each entry's own view. That was the S5 boundary to fix, found by adding a
second view with a different rule.

### S7. Public identity

`uid uuid NOT NULL DEFAULT gen_random_uuid()` with a unique constraint on items and
workspaces. The default fills existing rows as the column is added.

- The API returns `uid` on every item and workspace.
- Create accepts a client-chosen `uid` and inserts with `ON CONFLICT (uid) DO NOTHING`.
  A create repeated after a lost answer finds the item the first one stored, writes
  nothing, and answers `200` instead of `201`; the client then sends its content as an
  update. A uid held by an item elsewhere is refused with `409`.
- The client gives every open entry a uid and sends it with the create, so autosave
  retries, a reload that replays a draft, and the exit keepalive can all send a create
  without making a second item. The exit keepalive therefore sends drafts too.
- The address of an item is its uid (`?item=`). Older integer addresses still open.
- Backups carry `uid`. Restore keeps it when it is free and assigns a new one when it
  is taken.
- An item keeps its uid when it moves between accounts.
- Integer ids remain the primary and foreign keys. Nothing is swapped.

Requests that act on a loaded record keep using its integer id, which the client always
has. A route that is addressed from outside, starting with file routes in S8, takes the
uid. Device caches and links between items use the uid.

### S8. Files, the first capability with new storage

Photos, video, voice memos, receipts, and invoices are all "an item with a file", and the
`media` bucket is declared in `.railway/railway.ts`.

- `item_file_v1(id uuid, item_id, storage_key, content_type, byte_size, sha256,
original_name, role, position, width, height, duration_ms, time_created)`.
- The item service gains per-capability `validate` and `write` hooks that run inside
  the save transaction, and `afterCommit` for work that follows it. File rows are their
  first user; the columns of the item row stay in the single item statement.
- Upload and download through short-lived signed URLs. The storage key is `f/<uuid>`.
- A file with no text is a valid item under the S1 rule.
- Kinds `media` (image or video) and `voice memo` (audio), each with a view entry.
- Backup gains the file rows and bytes (an archive holding the JSON and each object,
  checked by `sha256` on restore).
- A client module for attach, preview, and remove, with drop and paste as its capture
  handler.

Done when this step changes no merge code, no save engine code, and no existing
capability or view. If it has to, the extension point is wrong and is fixed here.

### L1–L3. Lossless input

Three independent releases that can ship between any two steps above:

- **L1.** Store item text exactly as typed. Whitespace-only text is still no text;
  embeddings, search, and the `note` predicate trim when reading.
- **L2.** Give workspaces, categories, subcategories, statuses, and tags a generated
  `label_key` (NFKC, then lowercase) that carries uniqueness and lookups. Labels are
  still stored lowercase.
- **L3.** Drop the lowercase checks so labels display as typed, and export the cased
  form in backups, which the L2 importer already reads.

## 6. Later features

These are worth building. None blocks a content type, and each is an additive migration
on a populated database.

| Feature                                                 | Why it can wait                                                                          | What keeps it cheap                                                       |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Trash with 30-day purge                                 | `deleted_at` is a new column plus a filter on item reads.                                | Item reads share one select; capability tables are reached through items. |
| Edit conflicts and history                              | A `revision` column and a snapshot table add to items without changing them.             | One service function writes an item; snapshots serialize the registry.    |
| Sharing                                                 | A membership table replaces the ownership check.                                         | One workspace-access helper (section 3).                                  |
| Device sync and offline                                 | It is a product in itself. Evaluate an existing sync engine before designing a protocol. | `uid` (S7), then `revision`.                                              |
| Server-side kind filters and paging                     | Every item of a workspace is loaded at bootstrap today, so views filter in the browser.  | Each kind adds a SQL predicate tested against its TypeScript predicate.   |
| Manual card order on the board                          | Due-date order is enough for a first board.                                              | One nullable position column.                                             |
| Suggestions (dates, amounts, categories from content)   | Needs the capabilities it would fill.                                                    | Derived data is separate from user content (section 3).                   |
| Reminder delivery                                       | Needs a notification channel and zoned times.                                            | The schedule capability's `afterCommit` hook.                             |
| Retiring `/api/notes`, legacy views, and `DB_NOTES_URL` | Independent cleanup once old browser tabs have drained.                                  | Nothing new depends on them.                                              |

UUID primary keys are not planned. The integer key is an internal detail once `uid` is
the public identity.

## 7. Rollout

Railway runs the migration, then replaces the single running instance. For a minute or
two, the previous release serves requests against the new schema. So:

- A migration only adds. Anything the previous release reads or writes is dropped or
  renamed in a later release.
- A change that cannot be made compatible in one release ships as two: expand, then
  contract. S2 and S3b are that pair for the taxonomy, and S3b waits until production
  runs S2: promoting both to an environment in one release would drop the link table
  under a server that still reads it.
- During the S2 deploy, a category chosen through the previous release is written to the
  link table only and is not carried over, and the previous release cannot delete a
  category that files an item until the deploy finishes. Both are accepted because
  existing category data is disposable and the window is a minute or two.
- Backups: the importer reads every earlier version and rejects a newer one with a clear
  message. A restore that reaches the previous release during a deploy fails cleanly and
  succeeds on retry.

## 8. Decisions

Settled by the developer:

- **A. Taxonomy.** Workspace, then one category, then one subcategory, plus any tags. An
  item belongs to at most one category and one subcategory. The hierarchy is exactly two
  levels.
- **B. Existing categories.** Category data is disposable: an item in several categories
  keeps one, and the rest are dropped. Items, text, tags, statuses, and dates are
  preserved in place, with no database reset and no export and import.
- **C. Save rule.** Nothing in the data structure, the service, or downstream logic
  requires text. Requiring text is a rule of the current Notes screen only.
- **D. Kinds.** Fully automatic. A kind is computed from what the item holds, an item can
  be several kinds, and nothing about kind is stored or chosen by the user.
- **E. Sequence.** The Tasks view ships first because it needs no new storage and proves
  one item in two views. Files follow as the first capability with new storage. Trash,
  edit history, sharing, and device sync come after content types.

Assumed by this plan, to be corrected at approval if wrong:

- The service refuses only an item that holds nothing at all.
- An item is a task when it has a status, a due date, or a reminder.
- Category and subcategory are optional, and an item can be filed directly in a category.
- A subcategory label is unique within its category, so two categories can each have a
  subcategory named "ideas".
- Status stays one workspace-wide list, so each workspace has one board, filtered by the
  taxonomy selection.

Product rules the later features in section 6 must follow:

- Only the web app calls the API, so compatibility code is retired once the web client
  no longer needs it.
- Deleted items go to Trash and are purged automatically after 30 days.
- Edit conflicts keep both versions: the later save wins on screen, the overwritten
  version goes to the item's history, and the user is told so they can restore it.
- Workspaces will be shared. No sharing UI is planned yet.
- Labels display as typed. Uniqueness ignores case and Unicode normalization ("NYC" and
  "nyc" are one category).

## 9. Verification for each step

- `pnpm run db:migrate`, `pnpm run db:verify`, `pnpm --filter @lib/db-items test`,
  `pnpm run verify`; generated artifacts committed.
- A migration is tested against a populated pre-migration database (pattern:
  `testing/item-rename-migration.test.ts`): row counts, text, timestamps, tags, and
  statuses preserved, and the taxonomy backfill checked for single- and multi-category
  items.
- A step that changes the UI is exercised in a running app before its PR is ready.
- After promotion: pre-deploy migration success and app health per
  `docs/operations/notes-environments.md`.
