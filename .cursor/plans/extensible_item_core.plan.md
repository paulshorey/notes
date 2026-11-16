---
name: Extensible item core — one item, optional capabilities
overview: An item is identity, workspace, and taxonomy. Everything a user adds to it (text, a due date, a status column, files, amounts) is a capability declared once in a registry, and saving, account merge, backup, and the client all read that registry. Six steps make adding a capability a local change, and the last one ships the first new capability (files) to prove it. Trash, edit history, sharing, and device sync are later features that this structure keeps cheap, not prerequisites.
todos:
  - id: lossless_input
    content: "S1. Store item text as typed and match labels by a normalized key (PR #119), then one follow-up release that stops lowercasing labels."
    status: in_progress
  - id: capability_registry
    content: "S2. Capability registry in @lib/db-items/contracts: text, schedule, and status declared once; the service refuses an item with no content capability; the client uses the same rule."
    status: completed
  - id: capability_safe_lifecycle
    content: "S3. Account merge and restore move item rows instead of copying them; backup and duplicate detection read the registry; db:verify fails on an item table no capability declares."
    status: pending
  - id: public_identity
    content: "S4. Add a permanent uid (UUID) to items and workspaces as the public identity, client-generated on create so a retried create is harmless. Integer ids stay as internal keys."
    status: pending
  - id: client_modules
    content: "S5. Split ItemsApp.tsx into a save engine, open-item state, and one module per capability (editor control, list renderer, add affordance)."
    status: pending
  - id: files_capability
    content: "S6. Files as the first new capability, built only through the S2–S5 extension points: item_file_v1, upload and download routes on the media bucket, backup with bytes, and a client module."
    status: pending
isProject: true
---

# Extensible item core

## 1. Goal

`jot.new` stays a place where anyone opens a browser and types. What they type becomes
an item. Later they may add a due date, a status column, a receipt, a photo, a voice
memo, an amount, or tracked time to that same item. Nothing they stored before is
rewritten or lost when a new kind of content ships.

This plan makes "add a kind of content" a local change: one table, one registry entry,
one client module. It then proves that by shipping one.

## 2. The model

**Item.** `workspace_item_v1`: identity, one workspace, timestamps. No type column.

**Taxonomy.** Workspace, categories, and tags organize items. Any item can carry them.
They never count as content.

**Capabilities.** Everything else an item holds. Each capability is optional and
independent of the others:

| Capability | Stored today as                | Counts as content |
| ---------- | ------------------------------ | ----------------- |
| `text`     | `description` column           | yes               |
| `schedule` | `time_due`, `time_remind`      | no                |
| `status`   | `status_id` → workspace status | no                |

Planned: `files` (photos, video, audio, receipts, invoices), `amounts` (money), `times`
(zoned, all-day, recurring, and tracked time), `links` (parent/child, board, project).

**Content rule.** An item is saved only if it holds at least one content capability.
Today only `text` is content, so the text client keeps its rule: no text, no item. When
`files` ships as content, a photo with no caption becomes a valid item without touching
the rule.

**Perceived type.** "Note", "task", "receipt", "voice memo" are names for combinations of
capabilities, computed from what an item holds and never stored. The naming and
precedence rules are a later product decision. The registry already answers the question
they need: which capabilities does this item have.

Text and the two schedule columns stay on the item row. A capability with one value per
item does not need its own table, and moving these would change every query for no gain.

## 3. Adding a capability

This checklist is the definition of "extensible". Each step below exists to make one of
its lines true.

1. **Storage.** One value per item: a nullable column. Many values per item, or values
   with their own identity: a table `item_<name>_v1` with
   `item_id REFERENCES workspace_item_v1(id) ON DELETE CASCADE`. The table also carries
   `workspace_id`, with composite foreign keys to both sides, only when it references a
   second workspace-owned row (as the category and tag links do), so the database rejects
   a link across workspaces. New rows that are addressed from outside get a `uuid` key.
2. **Registry entry** in `contracts/item-capabilities.ts`: key, whether it is content,
   how to tell it is present, and (from S3) how it is exported, imported, and compared.
3. **Nothing else on the server.** Delete cascades. Account merge moves the item row, so
   its tables follow (S3). Backup and duplicate detection iterate the registry (S3).
4. **One client module**: editor control, list renderer, add affordance (S5).

Rules that keep this true:

- Never repurpose a column or give a stored value a second meaning.
- Store what the user meant: text as typed, labels as typed plus a key, money as integer
  minor units plus currency, original file bytes plus metadata.
- Derived data (embeddings, thumbnails, transcripts) is rebuildable and never in backups.
- File storage keys are opaque UUIDs with no user, workspace, or item id in them, so
  moving an item never touches the bucket.
- New SQL authorizes through one workspace-access helper instead of repeating the
  ownership join.

## 4. Steps

Each step is one PR and one release unless it says otherwise.

### S1. Lossless input

PR #119 stores item text exactly as typed and gives workspaces, categories, statuses, and
tags a normalized `label_key` (NFKC, then lowercase) that carries uniqueness. It keeps
labels stored lowercase for one release so the previous release can still read them.

One follow-up release drops the lowercasing triggers, so labels display as typed, and
switches the backup exporter to the cased format, which the importer from #119 already
reads.

### S2. Capability registry and the content rule

`contracts/item-capabilities.ts` declares `text`, `schedule`, and `status`, and exports
`itemCapabilities(item)` and `hasItemContent(item)`. They accept both a stored item and
a write request.

The item service refuses a create or update that would leave an item without content.
The storage layer still accepts a bare item, because the rule is product policy that
changes as capabilities are added. The client's "is this worth saving" check calls the
same function.

### S3. Capability-safe lifecycle

Today, signing in to an existing account copies each anonymous item into a new row, and
restore reuses that path. The copy lists every item column and link table by hand in
three places (`sql/user/anonymous.ts`, `sql/user/backup.ts`,
`sql/user/item-merge-identity.ts`). A capability table added without editing all three
is silently dropped when an anonymous user signs in. This is the one place where the
current structure loses data as content types are added, so it is fixed before any are.

- **Merge moves rows.** For each item: record its category and tag labels, remove those
  links, update `workspace_id` and `status_id` (remapped by label key) in one statement,
  and re-create the links against the destination vocabulary. The item keeps its id, so
  every table keyed by `item_id` follows with no code. Restore still stages a temporary
  account and merges it, and skips an item that already exists identically.
- **Registry-driven backup.** Each capability with stored data declares `export`,
  `import`, and `identity` (its contribution to duplicate detection). The exporter,
  importer, and identity hash iterate the registry. The backup version increases whenever
  the file gains a field, and the importer reads every earlier version.
- **Guard.** `db:verify` fails if a table has a foreign key to `workspace_item_v1` and is
  neither declared by a capability nor listed as derived.

Tests: a populated anonymous account with every capability merges into an account with a
same-named workspace and keeps item ids, links, and capability rows; a backup of every
capability restores into an empty account unchanged.

### S4. Public identity

`uid uuid NOT NULL DEFAULT gen_random_uuid()` with a unique index on items and
workspaces, backfilled by the migration.

- The API returns `uid` and accepts it wherever it accepts an item or workspace id.
- Create accepts a client-generated `uid` and inserts with `ON CONFLICT (uid) DO NOTHING`,
  then returns the row. A create that is retried after a lost response returns the same
  item instead of a duplicate.
- Backups carry `uid`. Restore keeps it when it is unused and assigns a new one when it
  is taken.
- Integer ids remain the primary and foreign keys. Nothing is swapped, and no client is
  forced to change.

Future external references use the uid: public URLs, device caches, and other items'
links.

### S5. Client capability modules

`ItemsApp.tsx` is 3,407 lines and holds the save engine, the open-item ring, workspace
and vocabulary state, and the form. A second capability's UI cannot be added to it
safely.

- Extract the save engine, open-item state, and workspace and vocabulary state into
  hooks and Zustand stores. `ItemsApp` becomes composition. No behavior change, and the
  existing open-item and autosave tests pass unchanged.
- Each capability becomes a module: editor control, compact list renderer, and add
  affordance. Text, schedule, and status are the first three.
- Draft signatures and the browser cache build from the registry, so a new capability
  is included in dirty checks without editing them.
- The list shows every item with content, replacing the `isTextItem` filters.

### S6. Files, the first new capability

Files come first because photos, video, voice memos, receipts, and invoices are all
"an item with a file", and the `media` bucket already exists in `.railway/railway.ts`.

- `item_file_v1(id uuid, item_id, storage_key, content_type, byte_size, sha256,
original_name, role, position, width, height, duration_ms, time_created)`.
- Upload and download through short-lived signed URLs. The storage key is `f/<uuid>`.
- Registered as content, so a file with no text is a valid item.
- Backup gains the file rows and bytes (an archive holding the JSON and each object,
  checked by `sha256` on restore).
- A client module for attach, preview, and remove.

Done when this step changes no merge code, no save engine code, and no existing
capability. If it has to, the extension point is wrong and is fixed here.

## 5. Later features

These are worth building. None of them blocks a content type, and each is an additive
migration on a populated database.

| Feature                                                 | Why it can wait                                                                                    | What keeps it cheap                                                       |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Trash with 30-day purge                                 | `deleted_at` is a new column plus a filter on item reads.                                          | Item reads share one select; capability tables are reached through items. |
| Edit conflicts and history                              | A `revision` column and a snapshot table add to items without changing them.                       | One service function writes an item; snapshots serialize the registry.    |
| Sharing                                                 | A membership table replaces the ownership check.                                                   | One workspace-access helper (section 3).                                  |
| Device sync and offline                                 | It is a product in itself. Evaluate an existing sync engine before designing a protocol.           | `uid` (S4), then `revision`.                                              |
| Zoned, all-day, and recurring times                     | It belongs with calendar views and reminder delivery. Existing instants migrate as "zone unknown". | It is an ordinary capability table (`item_time_v1`).                      |
| Retiring `/api/notes`, legacy views, and `DB_NOTES_URL` | Independent cleanup once old browser tabs have drained.                                            | Nothing new depends on them.                                              |
| Full Unicode case folding for labels                    | NFKC plus lowercase already merges the common cases.                                               | The key is a generated column and can be redefined.                       |

UUID primary keys are not planned. The integer key is an internal detail once `uid` is
the public identity.

## 6. Rollout

Railway runs the migration, then replaces the single running instance. For a minute or
two, the previous release serves requests against the new schema. So:

- A migration only adds. Anything the previous release reads or writes is dropped or
  renamed in a later release.
- A change that cannot be made compatible in one release ships as two: expand, then
  contract.
- Backups: the importer reads every earlier version and rejects a newer one with a clear
  message. A restore that reaches the previous release during a deploy fails cleanly and
  succeeds on retry.

## 7. Decisions

Settled by the developer:

- **A. Sequence.** The first new content type comes before Trash, edit history,
  sharing, and device sync. Those features do not block adding content, and building
  them first delays every content type behind machinery that has no users yet.
- **B. First capability.** Files (S6). They cover the most planned content (photos,
  video, voice memos, receipts, invoices), and the `media` bucket already exists. Richer
  scheduling waits for calendar views and reminder delivery.
- **C. Content rule on the server.** The API refuses an item with no content capability.
  The web client shows only items with content, so an item without any would be stored
  where the user cannot see or delete it.

Product rules that the later features in section 5 must follow:

- Existing data is preserved in place: no database reset, no export and import.
- Only the web app calls the API, so compatibility code is retired once the web client
  no longer needs it.
- Deleted items go to Trash and are purged automatically after 30 days.
- Edit conflicts keep both versions: the later save wins on screen, the overwritten
  version goes to the item's history, and the user is told so they can restore it.
- Workspaces will be shared. No sharing UI is planned yet.
- Labels display as typed. Uniqueness ignores case and Unicode normalization ("NYC" and
  "nyc" are one category).

## 8. Verification for each step

- `pnpm run db:migrate`, `pnpm run db:verify`, `pnpm --filter @lib/db-items test`,
  `pnpm run verify`; generated artifacts committed.
- A migration is tested against a populated pre-migration database (pattern:
  `testing/item-rename-migration.test.ts`): row counts, text, timestamps, and links
  preserved.
- After promotion: pre-deploy migration success and app health per
  `docs/operations/notes-environments.md`.
