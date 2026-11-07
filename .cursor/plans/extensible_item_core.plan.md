---
name: Extensible item core — settle the hard-to-change foundation in place, then add content types additively
overview: Before any content type beyond text ships, settle the parts of the item model that become expensive or destructive to change once more tables, clients, URLs, and devices depend on them — permanent IDs, lossless input, revisioned idempotent writes, soft delete, membership ownership, and a time facet. Every step is a forward, in-place migration applied by the existing Railway pre-deploy, so no database reset and no data export/import is ever required. After the foundation, every planned content type (reminders, schedules, files, media, money, kanban, time tracking, publishing, sharing) is an additive table plus a client capability module.
todos:
  - id: lossless_input
    content: "F1. F1a (PR #119): store item text exactly as typed and give labels a locale-independent NFKC key for uniqueness, while rollout triggers keep labels lowercased for previous-release servers. F1b (next release): drop those triggers so labels keep their casing."
    status: in_progress
  - id: permanent_ids
    content: "F2. UUID keys as new, never-renamed uid / *_uid columns: F2-pre makes merges move rows and alias retired integer IDs; F2a adds the columns and UUID-aware servers while clients stay on integer IDs; F2b ships the UUID client and moves primary and foreign keys to the uid columns. Integer id stays as the legacy ID. Merge moves rows; restore never overwrites."
    status: pending
  - id: revisioned_writes
    content: "F3. In two releases: F3a adds Client-generated UUIDv7 IDs, PUT /api/items/{id} with baseRevision (non-mutating 409, explicit overwrite), facet changes bump item revision, item_revision history, and a sync endpoint reading items, workspaces, vocabulary, and trigger-written tombstones under one snapshot with an xid8 watermark, while the client keeps POST/PATCH; F3b switches the client save engine to PUT."
    status: pending
  - id: soft_delete
    content: "F4. In three releases: F4a adds deleted_at plus deletion_id, read/write filters, and backup v6; F4b makes every delete a soft delete without exposing Trash; F4c exposes Trash, restore, and the scheduled 30-day purge, and adds a trigger that turns any non-purge DELETE into the same soft delete."
    status: pending
  - id: membership
    content: "F5. workspace_member keyed by (workspace_id, user_id) with exactly one owner matching user_workspace_v1.user_id; authorization becomes one membership predicate; the owner FK becomes RESTRICT in a second release after account deletion disposes of owned workspaces."
    status: pending
  - id: time_facet
    content: "F6. item_time (many per item: role, exactly one of instant or local date, IANA zone, RRULE) replaces time_due/time_remind in four releases: F6a adds the table, bidirectional sync, and server support for times[]; F6b lets clients author times[]; F6c stops using the old columns; F6d drops them. Backup v7 ships before F6a."
    status: pending
  - id: registry_guard
    content: "F7. Generalize the merge registry guard: db:verify fails unless every table reaching an item or workspace is classified for backup (authored or derived) and for move/merge."
    status: pending
  - id: client_capabilities
    content: "F8. Before F6, split ItemsApp.tsx along capability boundaries; derive an item's perceived type from the facets it has, and render each facet with its own module."
    status: pending
  - id: retire_compat
    content: "F9. Retire the note-era compatibility layer once its clients are drained: legacy views, user_note_v1_id_seq name, /api/notes facades, X-Items-Contract dual payloads, and @lib/db-notes; move Railway to DB_ITEMS_URL before removing DB_NOTES_URL. Draft upgraders and backup importers stay."
    status: pending
isProject: true
---

# Extensible item core

## Status: approved direction — product decisions recorded in section 9

## 1. Goal

`jot.new` stays a place where anyone opens a browser and types. Everything else a user
adds — a due date, a reminder, an image, an amount, a status column, a publish date —
extends the same item. The perceived type ("note", "task", "invoice", "post") is derived
from what an item has, never stored as an exclusive discriminator.

This plan settles, **now**, the things that would otherwise force a destructive reset or a
broad rewrite later, and leaves everything else as additive work. It deliberately does
**not** reset databases: every step is a forward migration that preserves existing
accounts, items, and history, applied by the Railway pre-deploy like any other release.

## 2. What already fits

- **One item, no type column.** `workspace_item_v1` has one `workspace_id`, nullable
  `description`, and no type field. `isTextItem` (nonblank text) selects notes for the
  current client. This is the right base and does not change.
- **Workspace-scoped vocabulary with composite FKs** that reject cross-workspace links.
- **Database-first discipline:** forward-only migrations, generated schema/types/contracts,
  `verify-contract.mjs`, the merge registry guard, versioned portable backups.
- **Anonymous users are ordinary users.** Sign-up claims the anonymous row in place;
  sign-in to an existing account merges it.

## 3. What becomes expensive later, and why it must be settled first

Ordered by how much future code and data would depend on it.

| #   | Today                                                                                                                                                                                                                       | Why it hurts later                                                                                                                                                             | Cost if deferred                                                                                                      |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| 1   | `integer` serial IDs; anonymous merge into an existing same-named workspace (the usual case: every account has `personal`) and backup restore **copy items under new IDs** (`sql/user/anonymous.ts`, `sql/user/backup.ts`). | Every future reference to an item — file attachments, item links, subtasks, kanban positions, public post URLs, reminders, offline device copies — breaks on merge or restore. | Changing a key type rewrites every referencing table, URL, storage key, and backup format. Grows with each new table. |
| 2   | Server allocates IDs; the client separates create (POST) from update, with careful no-retry handling. Saves are last-write-wins with no revision.                                                                           | Multiple devices, offline capture, voice transcription arriving late, and collaborators all silently overwrite each other.                                                     | Every new client (mobile, API, agent) re-implements the race handling.                                                |
| 3   | Hard delete.                                                                                                                                                                                                                | No trash or undo; no tombstones for devices to learn about deletions; deleting a parent item later (project, invoice) destroys children irrecoverably.                         | Every query written before soft delete must be revisited to add the filter.                                           |
| 4   | Ownership is `user_workspace_v1.user_id`, checked by every query.                                                                                                                                                           | Sharing a board with a partner, team, or client is impossible without touching every authorization query.                                                                      | Linear in the number of queries; grows with every content type.                                                       |
| 5   | `time_due` / `time_remind` are single `timestamptz` columns from a `datetime-local` input.                                                                                                                                  | No time zone, no all-day vs timed, no recurrence, one of each per item. Schedules, reminders, calendars, and time tracking all need many times per item.                       | Information the user meant is lost on every write and cannot be reconstructed.                                        |
| 6   | Text is trimmed on write (`toNullableText`); labels are lowercased by check constraints.                                                                                                                                    | Markdown/code whitespace is altered; "NYC", "iOS", "Q3 Plan" cannot be displayed as typed — this matters once categories become blog sections or kanban columns.               | Lost on every write; unrecoverable.                                                                                   |

Everything else — embeddings layout, a unified vocabulary table, JSON properties, titles,
item links, files, money, publishing — can be added later without destroying anything,
so it is **not** part of the foundation.

## 4. Principles for every future change

1. **Identity is permanent.** UUIDs, generated by the client (server fallback). IDs never
   change on move, merge, restore, or publish, and never encode ownership.
2. **No exclusive type discriminator.** Perceived type is derived from facets present.
3. **Capabilities are additive.** A new content type is a new facet table keyed by
   `item_id` (1:1 or 1:N), or a new `item_link` kind. Never repurpose an existing column.
4. **Store intent losslessly.** Text as typed; labels as typed plus a normalized key;
   local dates vs instants plus IANA zone plus RRULE; money as integer minor units plus
   ISO currency; original file bytes plus metadata.
5. **No hard delete in the request path.** `deleted_at` → trash → purge.
6. **Writes are idempotent and revisioned.** `PUT` by ID with `baseRevision`.
7. **Derived data is disposable.** Embeddings, search vectors, thumbnails, transcripts are
   keyed by model/version and rebuildable; they are excluded from authored backups.
8. **Authorization is one membership predicate.** Every table that links two
   workspace-owned rows carries `workspace_id` and composite FKs to both sides, so a link
   can never cross workspaces.
9. **Every table is classified** for backup and move/merge, enforced by `db:verify`.
10. **Workspace is the sharing boundary, not a project.** Projects, boards, invoices,
    and posts are items related through `item_link`.

## 5. Foundation phases

Each phase is one PR, independently releasable through the normal `main` → `prod` flow,
with migrations applied by Railway pre-deploy. Each keeps the web client working.

### F1. Lossless input (first — it stops data loss today)

F1 is expand/contract because previous-release servers read, export, and validate labels
as lowercase:

- **F1a (PR #119).** Items store `description` exactly as received; blank-or-whitespace
  text is still "no text" for `isTextItem`, search, and embeddings. Workspaces,
  categories, statuses, and tags get a generated `label_key`
  (`app_label_key_v1(label)`: NFKC, then ICU-root lowercasing, matching the client's
  `labelKey`) that carries uniqueness, and labels are stored without surrounding
  (ECMAScript `trim()`) whitespace. Rollout triggers still store labels lowercased, while
  clients and APIs send them as typed.
- **F1b (next release, after F1a has fully replaced the previous one).** A migration
  drops the lowercasing triggers; labels then keep the casing typed. Existing labels
  keep their current text.
- The migration audits existing rows first: legacy padding is trimmed, and any labels
  that would be blank or share a key after trimming and NFKC normalization (for example
  precomposed and decomposed `é`) stop the pre-deploy with a count. There is no automatic
  merge; an operator resolves the listed rows and redeploys.
- Merge, restore, backup, and `resolve*` helpers match by `label_key`; reusing a label
  never rewrites its casing.
- Portable backup version 3 stores labels as typed. Version 1 and 2 files keep their
  lowercase label rule, and the version 1 download for older clients lowercases labels,
  so a file an older deployment can read never contains cased labels.
- A version 1 or 2 file can hold two labels that were distinct under the old rules but
  share a `label_key` (Unicode compatibility forms). F1's importer keeps both
  losslessly: within a workspace (and across workspace labels), the later colliding
  label gets a suffix (`ｑ3 (2)`) and every reference in the file is remapped to it
  before restore. Version 3 files, which identify labels by key, still reject key
  duplicates.

### F2. Permanent IDs, in place

The previous-release server queries `workspace_item_v1` and the other base tables
directly with integer IDs, and Railway applies migrations before it is replaced. Every
schema change therefore stays compatible with the release still running, and **no
column is ever renamed** (a rename breaks whichever release still uses the old name):

- UUID keys are new, permanently named columns: `uid` on each existing authored table
  and `workspace_uid`, `item_uid`, `status_uid`, `category_uid`, `tag_uid` for
  references to them. Tables created after F2 use `id uuid` for their own key and the
  same `*_uid` names for references to pre-F2 tables. API field names (`id`,
  `workspaceId`) are independent of column names.
- Integer `id` columns stay as the legacy IDs. A column is dropped only in a release
  after the last code that references it has shipped and drained.

0. **F2-pre (release before F2a).** Anonymous merge and backup restore stop copying
   items under new IDs: they move rows (`UPDATE … SET workspace_id`, remapping
   `status_id` and links by `label_key`) and record each retired source row — a
   deduplicated item or a merged-away workspace or term — in `id_alias_v1` with its
   integer `id` and its `uid` and the survivor's, read before the delete. This migration also recreates the item/link and vocabulary/link
   composite FKs as `DEFERRABLE INITIALLY IMMEDIATE` with `ON UPDATE CASCADE` where a
   moved key must follow, and the merge sets them `DEFERRED` for its transaction, so a
   linked item can move atomically. The identity
   guarantee starts once F2-pre has replaced every server: a merge served by a
   previous-release server during F2-pre's own rollout copies under new integer IDs,
   exactly as every merge does today, and the client reloads its items after sign-in as
   it already does. F2-pre also adds `app_uuid_v7()` (SQL; replaced by native
   `uuidv7()` when the database runs PostgreSQL 18) and the `uid` column on every
   authored table, with that default, backfilled and uniquely indexed, so the backup v4
   exporter and importer have stored UUIDs to carry and generate new rows' UUIDs.
   Nothing reads UUIDs for requests yet.
1. **F2a — expand (release N).** Add the `*_uid` reference columns, backfilled, beside
   every integer reference (link tables and the direct `status_id` included). Triggers
   keep integer and UUID references in sync in both directions, so writes from either
   release populate both. Integer `id`
   stays the primary key with its sequence, so previous-release servers keep working.
   Release N's servers read and write by UUID and understand both contracts, but the
   shipped client still sends contract 1 (integer IDs), so a request landing on an
   F2-pre server during the rollout still works.
2. **F2b — key swap and UUID client (release N+1).** The client switches to contract 2
   (UUIDs) and the browser-storage upgrader below ships, now that every server
   understands UUIDs. Move primary keys and the composite workspace FKs
   to the `uid` columns, keeping them `DEFERRABLE` as in F2-pre. This changes constraints only; no column is renamed or dropped,
   so release N keeps working during the overlap. Integer `id` stays unique with its
   sequence default until F9.
3. `id_alias_v1` has columns `kind`, `alias_id uuid`, `alias_legacy_id integer`,
   `target_id uuid`, and `target_legacy_id integer`. Since F2-pre already stores a `uid`
   on every row, each alias is recorded with all four values while both the retired row
   and its survivor still exist, so nothing has to be recovered after the source row is
   deleted. Its key is `(kind, alias_id)`, since the same UUID may identify rows of
   different kinds; `(kind, alias_legacy_id)` is unique too. It
   records retired IDs (`kind` in `item`, `workspace`, `category`, `status`, `tag`),
   including the retired row's integer `id` (unique per `kind`), so old numeric URLs,
   contract-1 requests, and the storage upgrader still resolve it. Aliases are always one
   hop: retiring a row in favor of another also repoints every alias that targeted the
   retired row, in the same transaction, together with the `replaced_by` of any
   outstanding `merged` tombstones (F3), and `db:verify` checks that no `target_id` is
   itself an alias. Every lookup by ID resolves an alias once.

Code:

- Contracts change `id: number` → `id: string` for items, workspaces, and vocabulary,
  selected by a new contract version: clients that send `X-Items-Contract: 2` get and
  send UUIDs. A browser tab still running the previous build sends
  `X-Items-Contract: 1` and keeps receiving and sending integer IDs (served from the
  integer columns) until it reloads. Servers understand contract 2 from F2a, but
  clients only send it from F2b, so a new tab never reaches a server that predates
  it. Contract 1 is retired in F9.
- `GET /api/items/{id}` and open-item URLs accept a UUID, an alias, or a legacy integer
  and redirect to the canonical UUID form.
- Browser storage v4 upgrader (ships with the contract-2 client in F2b) maps integer IDs in cached items and dirty drafts to UUIDs
  through a lookup endpoint; dirty drafts are never discarded on failure.
- Server-side preferences: F2a's bootstrap accepts `currentWorkspaceId` as either the
  integer or the UUID and keeps writing what it read, so previous-release servers still
  find the user's workspace during the rollout. F2b's migration, once they have drained,
  rewrites stored integers to UUIDs; bootstrap keeps resolving an integer through the
  integer `id`.
- Anonymous merge **moves** rows instead of copying under new IDs:
  - no same-named destination workspace → the workspace itself moves (F5: membership and,
    `user_workspace_v1.user_id`), keeping its UUID;
  - same-named destination workspace, and **both** have no member other than their
    owner (F5) → items move with one `UPDATE … SET workspace_id`
    that also remaps `status_id`, and category/tag links are remapped, all by
    `label_key` (missing destination terms are created first); the source workspace and
    its vocabulary rows become aliases of their destination counterparts;
  - a same-named pair where either workspace has other members is never merged: the
    source workspace moves as a whole with a suffixed label, so no member gains access
    to content outside the workspace they were given;
  - content-identical items are still deduplicated, but the skipped source item's UUID
    becomes an alias of the surviving destination item. The identity covers every
    authored facet of the item (it is computed from the F7 registry of `authored` +
    `follows-item` tables, including the facet IDs), so items that differ in times, files,
    or other facets are both kept; items whose facets carry different IDs for equal
    content are deduplicated only after each source facet ID is aliased to its surviving
    counterpart in `id_alias_v1`, so a queued edit carrying a source facet ID follows it; the skipped item's revision history is appended to the survivor's before
    the source is retired. The merge takes `FOR UPDATE` on the source workspace row,
    then locks the source items, every candidate destination item, and every
    vocabulary row (status, category, tag) either side uses
    (`SELECT … FOR UPDATE`) before computing identities, and holds all of these locks
    through history transfer, aliasing, and retirement. From F2-pre on, creating or
    moving an item takes `FOR SHARE` on its workspace row, so no item can be created in
    the source workspace mid-merge and no compared item changes before the decision is
    applied.
- Portable backup versions are immutable, and each new kind of authored state gets its
  own: v3 (cased labels), v4 (UUIDs), v5 (revisions), v6 (trash), v7 (times). A version's
  exporter and importer ship in the release **before** the one that first writes the
  state it carries, with the new fields empty until then, so a backup served by the
  previous release during a rollout never omits that state: v3 in F1a (casing starts in
  F1b), v4 in F2-pre (UUIDs start in F2a), v5 in F2b (revisions start in F3), v6 in F4a
  (soft deletion starts in F4b), and v7 in F8 (time facets start in F6a). Every version keeps an importer, and from F2 on every importer uses the
  UUID-first insert and remap path (no integer sequence or default is called), so
  removing integer allocation in F9 changes nothing for restores. Backup v4 carries
  UUIDs. Restore never overwrites an existing row:
  - UUID not present anywhere, and not in `retired_id_v1` or `id_alias_v1` (a retired or
    aliased UUID counts as occupied) → inserted with that UUID;
  - UUID that is retired or aliased → cloned under a new UUID, with the backup's
    internal references remapped to it;
  - UUID present in the restoring account with identical content, in the workspace the
    backup's workspace maps to, and with the same lifecycle state (`deletedAt` and
    `deletionId`, v6 and later) → skipped; if it has since moved to another workspace
    or its lifecycle state differs (live versus in Trash, or a different deletion
    batch), it is cloned instead, keeping the backed-up state, so the backup's internal links and attachments stay inside
    the restored workspace;
  - UUID present in the restoring account with different content (an older backup of an
    item edited since) → the backed-up version is added alongside as a clone with a new
    UUID, as restores do today;
  - UUID owned by a different account (restoring into a second account while the
    original still exists) → cloned with a new UUID; the other account's rows are never
    transferred or reassigned.
    Clones get new UUIDs for every cloned row and every reference inside the backup is
    remapped. Importers for v1/v2 remain.

### F3. Revisioned, idempotent writes and a sync cursor

- `workspace_item_v1.revision bigint NOT NULL DEFAULT 1`. Every **authored** mutation of
  an item or of anything it owns (category/tag links, `status_id`, and every later facet
  such as `item_time_v1`, `item_file_v1`) bumps the owning item's `revision` in the same
  transaction, through per-table triggers. Derived-only updates (embeddings, thumbnails)
  do not, and neither do `history` tables (below). F7's guard requires the trigger on
  every table classified `authored` + `follows-item`.
- Sync cursor: each changed row of `workspace_item_v1`, `user_workspace_v1`, and the
  vocabulary tables records `change_xid xid8 DEFAULT pg_current_xact_id()` (updated by
  trigger). A sync response returns rows with `change_xid >= cursor` and a new cursor of
  `pg_snapshot_xmin(pg_current_snapshot())`. No in-flight transaction can commit below
  that watermark, so commit reordering never hides a change; rows may repeat and clients
  apply them idempotently: items by revision, and workspace, vocabulary, and membership
  rows by `change_xid` (a client never replaces a cached row with one carrying a lower
  `change_xid`). Clients also run one sync request at a time and apply cursors in order. A plain sequence is not used because a lower value
  can commit after a higher one has been read.
- A cursor is `(generation, xid)`. `generation` is a UUID in a one-row table, created
  with the database and replaced whenever the database is restored or replaced. A
  cursor from another generation, or with an `xid` ahead of the current one, gets
  `410 Gone` and a full resync, since XIDs are meaningful only within one database.
- Tombstones are returned in `change_xid` order, and clients apply them in that order.
- `GET /api/sync?since=<cursor>` returns three lists — items, workspaces, and
  vocabulary — plus tombstones, so empty workspaces, unused labels, and deletions sync
  too. Sync is exempt from the live-row filter: from F4 on, a soft-deleted item or
  workspace is a changed row and is returned with its `deletedAt`, so other devices move
  it to Trash immediately rather than at purge time. Each workspace row carries the
  requester's current role, and a membership role change bumps that workspace's
  `change_xid`, so a member's devices learn an upgrade or downgrade on their next sync.
  All lists and the new cursor are read in one `REPEATABLE READ` read-only
  transaction, so they come from the same snapshot and a commit between two reads cannot
  be skipped.
- Tombstones: `sync_tombstone_v1` rows (`user_id`, `kind`, `entity_id`, `workspace_id`,
  `reason` (`deleted`, `revoked`, `merged`, or `moved`), `revocation_id`, `replaced_by`
  (the surviving ID for `merged`; the new workspace for `moved`),
  `change_xid`, `deleted_at`) are written by `AFTER DELETE` triggers on items, workspaces, and
  vocabulary tables, so every existing hard-delete path (item and vocabulary deletion
  today, the F4 purge later) produces a deletion record from F3 onward. Each deletion
  writes one tombstone row per user who could read the workspace at that moment (its
  creator before F5, its members after); sync returns only the requester's rows. Single
  item and vocabulary deletes read that audience in their trigger while the workspace
  still exists. Whole-workspace deletes are covered by a `BEFORE DELETE`
  row trigger on `user_workspace_v1` that writes tombstones and `retired_id_v1` markers
  (with the workspace's owner) for the workspace and every row it contains before the
  cascade runs. It fires for every delete path, including a
  previous-release server's direct `DELETE` during the F3 rollout, so the cascade never
  has to look up authorization state that it is removing; the row triggers skip
  entities already tombstoned in that transaction. Link removals are item changes (they bump the
  item's revision).
- Moving an item to another workspace is allowed only if every link or attachment it
  has points at something that moves with it or that the destination already holds;
  otherwise the move returns `409` listing the links, and the caller either removes them
  (an authored edit kept in the item's history) or moves the related items too. The
  descendant retirement markers (below) move with the item.
- Moving an item to another workspace is an update, not a delete, so a trigger on the
  item's `workspace_uid` writes `moved` tombstones for the members of the source
  workspace who cannot read the destination, before the change is visible, and those
  members' devices drop the item.
- Tombstones are retained for 180 days by `deleted_at` (indexed). The retention job
  records the highest `change_xid` it removed as the sync horizon; a cursor at or
  below the horizon gets `410 Gone` and a full resync (sync reads `change_xid >= cursor`,
  so a cursor equal to a purged tombstone's XID can no longer be served).
- `PUT /api/items/{id}` upserts by client-generated UUIDv7 with `baseRevision`. Creation
  is refused with `410 Gone` when the ID is in `retired_id_v1(kind, uid)` (primary key
  `(kind, uid)`) or `id_alias_v1`. The UUID of every hard-deleted authored entity (item,
  workspace, category, status, tag, and later facets with their own identity) is added
  to `retired_id_v1` and kept permanently (about 16 bytes per row), independent of
  tombstone retention; creation of any kind checks it, so a
  delayed retry can never recreate deleted content while an item created offline long
  ago still syncs. Only backup restore may bring back a retired ID, and it does so by
  cloning. Creation, aliasing, and retirement of an ID all take a transaction-scoped
  advisory lock on `(kind, uid)` before checking or writing, so a create racing the
  delete of the same ID either commits first (and is then deleted and retired) or sees
  the retirement and is refused.
  - every PUT, including one that changes only links or facets, first locks the item
    row (`SELECT … FOR UPDATE`) and checks `baseRevision` while holding that lock
    through all of its authored writes, so two concurrent writers from the same
    revision cannot both pass;
  - matching `baseRevision` → applied, `200` with the new revision;
  - content identical to the current server copy → `200`, no change (makes every retry
    of an already-applied write a no-op);
  - stale `baseRevision` → `409` with the server copy and its revision; **nothing is
    written**.
  - D4 resolution is a second, explicit request: the client resends its content with
    `baseRevision` set to the server revision from the `409` and
    `resolution: "overwrite"`. The server snapshots the version being overwritten into
    `item_revision`, applies the write, and returns `200` with `overwrote: <revision>`;
    the client then notifies the user with a link to that history entry. If the server
    moved again in between, the overwrite request gets its own `409` and repeats.
  - Every PUT carries a client-generated `mutationId`. The server records the result of
    every acknowledged request, including an identical-content no-op, in `item_mutation_v1(item_uid, mutation_id, response, created_at)`,
    kept for 7 days, in the same transaction that decides the response. A retry whose response was
    lost replays its own recorded result (including `overwrote` and its history link)
    even after later mutations changed the item.
- Every ordinary item mutation (create, update, links, facets, and the pre-F3
  `POST`/`PATCH` routes) requires both the item and its workspace to be live
  (`deleted_at IS NULL`); a write to a trashed item or into a trashed workspace returns
  `409`. Deleted rows are reachable only through the Trash read and restore. Each
  mutation takes `FOR SHARE` on its workspace row, and a workspace delete takes
  `FOR UPDATE` on it for the whole batch, so a create cannot slip in beside a
  workspace being trashed.
- `item_revision` keeps coalesced snapshots (per editing burst, and always before a
  conflicting overwrite, delete, or merge). A snapshot holds the item's restorable
  authored content: its authored base columns plus every `authored` + `follows-item`
  facet, with vocabulary links recorded by label and `label_key` rather than only by
  term ID. Restoring a history entry keeps the item's current identity, workspace,
  revision, and lifecycle fields (a restore is a new revision), and resolves each link
  by `label_key` in the current workspace, creating the term under a new ID if it was
  deleted. as one JSON document whose
  The document's shape is generated from the F7 registry, so restoring a history entry
  restores times, links, and later facets too. `item_revision` is classified `history`: portable and
  moved with its item, but excluded from revision triggers and from snapshot contents,
  so writing a snapshot never bumps the item and snapshots never nest. Backup v5 (shipped in
  F2b, before F3) carries each item's revisions; restore brings them back with an inserted
  or cloned item, and for a skipped identical item it appends the backed-up snapshots
  the destination does not already have (matched by each snapshot's own UUID, so two
  snapshots with the same content at different times are both kept), so no history is
  lost.
- F3 ships in two releases. **F3a** adds the PUT endpoint, revisions, history, sync, and
  tombstones on the servers while the client keeps saving through POST/PATCH; **F3b**
  (next release, when every server implements PUT) switches the client save engine,
  dropping the create/update split and the POST no-retry hazard: every save is a
  retryable PUT. A new tab therefore never sends a PUT to a server that lacks it.
- The existing `POST`/`PATCH` item routes stay through the loaded-browser overlap for
  tabs opened before F3. A write on them carries no `baseRevision`, so the version being
  replaced is snapshotted into `item_revision` before it is applied (last write wins,
  nothing lost). They are retired in F9.
- Snapshot capture is a database trigger, so it also covers a previous-release server's
  writes during F3's rollout: a `BEFORE UPDATE` trigger on items (and the facet
  triggers) snapshots the old version unless the transaction marks
  `app.snapshot_handled` for that item: F3's code sets it to the UID of the one item it
  just snapshotted and clears it after that item's write, so other items written in the
  same transaction (a vocabulary deletion or a merge) still get their own snapshots.

### F4. Soft delete and trash

- `deleted_at timestamptz` on items and on workspaces. Facets (time rows, file
  attachments, links) have no Trash of their own: removing one is an edit to its item,
  the item's revision snapshot keeps it so history can restore it, and a facet row with
  its own ID is retired in `retired_id_v1` when removed.
- Normal reads filter `deleted_at IS NULL` (partial indexes keep this cheap). The Trash
  view uses a separate, membership-authorized read, `GET /api/items/trash?workspaceId=`,
  that returns only deleted items in workspaces the requester can read; restore is
  `POST /api/items/{id}/restore`. While an item's workspace is deleted, item-only restore
  returns `409` and Trash shows the workspace as one entry; restoring the workspace
  restores it with its batch atomically.
- Every trash operation records a `deletion_id uuid` with `deleted_at`. Deleting a
  workspace soft-deletes the workspace and moves its live items to trash under the same
  `deletion_id`; restoring the workspace restores only rows with that `deletion_id`, so
  items that were already in Trash stay there. `DELETE /api/workspaces` no longer issues a SQL
  `DELETE`, so items never cascade away outside the purge.
- F4 ships in three releases. **F4a** adds the columns and the `deleted_at` filters on
  every read and write, while nothing is soft-deleted yet, and backup v6 export and
  import (`deletedAt` and `deletionId`, still null everywhere). **F4b** (next release,
  when every server filters) makes every delete path a soft delete — item and workspace
  routes, with the workspace batch — but does not expose Trash yet; previous-release
  servers never see a trashed row as live, and their direct deletes during this rollout
  still hard-delete, as before F4, with F3 tombstones, which nothing yet promises
  otherwise. **F4c** (next release, when every server soft-deletes) exposes Trash,
  restore, and the scheduled purge, and adds a safety net: a `BEFORE DELETE` trigger on
  items and workspaces turns any `DELETE` into the same soft delete the routes perform
  (for a workspace, the full batch: the workspace and its live items under one
  `deletion_id`), then cancels the row delete, unless the transaction sets
  `app.hard_delete = 'on'`, which only the purge, account deletion, and merge
  retirement do (below). F4b already sets that flag in account deletion and the anonymous-cleanup command, so their previous-release copies keep hard-deleting during F4c's rollout; the purge sets it from its first release. F4c also
  gates the F3 workspace tombstone trigger on `app.hard_delete = 'on'`, so a converted
  delete never emits hard-delete tombstones; the item tombstone triggers are
  `AFTER DELETE` and do not fire for a canceled delete.
- Hard deletes of items and workspaces happen only in purge paths (items and
  workspaces whose `deleted_at` is older than 30 days (D3), writing tombstones first),
  account deletion including the abandoned-anonymous cleanup, and identity retirement
  during a merge (a merged-away workspace or deduplicated item). Each sets
  `app.hard_delete = 'on'` only around its own delete statements and resets it after.
  A retirement writes a tombstone with `reason = 'merged'` and `replaced_by` for the
  users of the surviving workspace (for an anonymous merge, the permanent account,
  since the anonymous one is deleted), and the sign-in response also returns the alias
  map, so clients replace references instead of losing content.
- Category, status, and tag deletion stays immediate: removing a label never removes
  item content, and the removed links are an authored change to each affected item, so
  its revision snapshot keeps the previous labels and history can restore them (under a
  new term ID, since the deleted one is retired). A `BEFORE DELETE` trigger on each
  vocabulary table snapshots every affected item while the term's label still exists,
  before the link rows cascade. D3's
  30-day Trash applies to items and workspaces.
- Purge is scheduled, not manual: F4 adds a Railway cron service (declared in
  `.railway/railway.ts`) that runs the purge command daily in each environment. It is
  replaced by the background worker when that exists. The 30-day promise ships only with
  the schedule.
- Portable backups carry trash state: backup v6 adds `deletedAt` and `deletionId` to
  workspaces and items. Restore keeps trashed rows in Trash with the same batch
  grouping and their original `deletedAt` (so the remaining retention carries over);
  v1–v5 files restore as live rows.
- Restore merges a backed-up workspace into a destination workspace only when both are
  live, share a `label_key`, and have no members other than their owner. When the
  backed-up workspace UUID is otherwise unused, it records that UUID as an alias of the
  destination, as anonymous merge does; a UUID owned by another account is never
  aliased (the restore clones under a new UUID instead). A trashed backed-up workspace, or one whose label
  collides with a trashed destination workspace, is restored as a separate workspace
  with a suffixed label (`personal (restored 2027-01-02)`), so restore never trashes,
  restores, or otherwise changes an existing workspace.

### F5. Membership ownership

- `workspace_member(workspace_id, user_id, role)` with primary key
  `(workspace_id, user_id)`, so each membership has one authoritative role, and
  `role IN ('owner','editor','viewer')`. A partial unique index allows at most one
  `owner` per workspace, and a deferred constraint trigger checks at commit that every
  workspace has exactly one owner membership and that its user equals
  `user_workspace_v1.user_id`, so authorization, label uniqueness, merges, and account
  deletion always agree on the owner. Memberships are backfilled with one `owner` per existing
  workspace. An `AFTER INSERT` trigger on `user_workspace_v1` also creates the owner
  membership, and an `AFTER UPDATE OF user_id` trigger moves the owner membership with
  the owner column (promoting the new owner's existing membership when there is one),
  so workspaces created or merged by a previous-release server during the rollout keep
  the owner invariant; both stay until F9.
- `user_workspace_v1.user_id` remains as the workspace **owner**, with the existing
  unique `(user_id, label_key)`. Its FK changes from `ON DELETE CASCADE` to
  `ON DELETE RESTRICT` in two releases: **F5a** ships the account-deletion and
  anonymous-cleanup code below while the FK still cascades; **F5b** (next release, after
  F5a replaced every server and cleanup job) switches the FK. Deleting an account (including the abandoned-anonymous cleanup)
  first disposes of every workspace it owns, then deletes the user:
  - a workspace with other members is transferred to one of them (an editor if any);
    if the new owner already owns a workspace with the same `label_key`, the transferred
    workspace is renamed in the same transaction with a suffix (`personal (2)`), and
    the workspace's `retired_id_v1` markers move to the new owner;
  - a workspace with no other members is deleted through the workspace-delete function
    (tombstones first). Trash is not used here because no account remains to restore it.
    So an owner's deletion never destroys collaborators' content, and nothing still
    references the user when it is deleted. Labels are unique among the workspaces a user owns;
    workspaces shared with them by others are never merge or restore targets. Anonymous
    merge and backup restore pick their destination among owned workspaces only.
- One SQL predicate (`can_read_workspace` / `can_write_workspace`) replaces per-query
  ownership joins for authorization, including the raw SQL in
  `scripts/cleanup-anonymous-users.mjs` and other maintenance scripts.
- Anonymous link when the destination has no same-named workspace moves the membership
  **and** updates `user_workspace_v1.user_id` to the permanent account in the same
  transaction, so deleting the anonymous user cannot cascade through the owner FK. If
  the permanent account is already a member of that workspace, its existing membership
  is promoted to `owner` and the anonymous owner's row is removed, in the same
  transaction.
  When the destination has a same-named workspace, items move as in F2.
- Membership changes reach sync: granting access writes a per-user event that makes
  the member's next sync fetch that workspace in full as an authoritative reset (the
  client replaces everything it cached for that workspace, so rows deleted while the
  member had no access disappear), and revoking access writes a
  workspace tombstone for that user so their devices drop its content. A revocation's
  tombstones carry `reason = 'revoked'` and one `revocation_id`. A grant deletes only that
  user's `revoked` tombstones for the workspace in the same transaction, so a revoke
  followed by a re-grant never reaches a client as a deletion, while genuine `deleted`
  tombstones the user has not yet synced are kept.
- No sharing UI is built in this phase; roles other than `owner` stay unused until
  sharing is designed (D5).

### F6. Time facet

```sql
CREATE TABLE item_time_v1 (
  id uuid PRIMARY KEY DEFAULT app_uuid_v7(),
  item_uid uuid NOT NULL, workspace_uid uuid NOT NULL,
  role text NOT NULL,               -- 'due' | 'remind' | 'start' | 'end' | 'event' | ...
  at timestamptz,                   -- a specific instant
  on_date date,                     -- an all-day / floating date
  end_at timestamptz, end_date date,
  time_zone text,                   -- IANA zone the user meant
  rrule text,                       -- RFC 5545 recurrence
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Exactly one start representation; an end, if present, uses the same one.
  CHECK (num_nonnulls(at, on_date) = 1),
  CHECK (end_at IS NULL OR at IS NOT NULL),
  CHECK (end_date IS NULL OR on_date IS NOT NULL),
  -- A range never ends before it starts.
  CHECK (end_at IS NULL OR end_at >= at),
  CHECK (end_date IS NULL OR end_date >= on_date),
  FOREIGN KEY (item_uid, workspace_uid) REFERENCES workspace_item_v1(uid, workspace_uid)
    ON DELETE CASCADE ON UPDATE CASCADE
);
-- Roles the text client shows as single fields have at most one row per item.
CREATE UNIQUE INDEX item_time_v1_single_role_idx ON item_time_v1 (item_uid, role)
  WHERE role IN ('due', 'remind');
```

- Rollout is three releases. **F8** (before F6a) creates `item_time_v1`, empty, together
  with the v7 exporter and importer, so a v7 file with all-day, recurring, or
  multi-valued times can be persisted by any server from then on. **F6a:** backfill `due` /
  `remind` rows from the existing columns (`time_zone` NULL: unknown), and keep both
  representations synchronized in both directions by triggers: a write to
  `time_due`/`time_remind` (from a previous-release server) updates the projectable
  row, and a write to the role's row updates the column: its instant when the row is
  projectable, `NULL` when the row becomes all-day or is removed. A `NULL` written to
  the column by an old server still leaves an all-day row untouched. A mirror trigger
  saves the current `app.mirror_write` value, sets it only around its own nested
  statement, and restores it immediately after; the F3 revision trigger skips only
  writes made inside that nested statement, so one logical edit bumps the item's revision exactly once, from the
  write that originated it, and an old server's `UPDATE … RETURNING` sees the final
  revision. F6a servers also accept and return `times[]`, but the client keeps writing
  the scalar fields. **F6b** (next release, when every server is time-aware) lets the
  client author `times[]`, so no time edit reaches a server that cannot store it.
  **F6c** (next release, after F6b has replaced every server) ships code that no longer
  reads or writes the scalar columns or relies on the sync triggers, leaving them in
  place. **F6d** (next release, after F6c has replaced every server) drops the triggers
  and the columns.
- Backup v7 carries `times[]` per item and ships in F8, with the empty table it restores into, before F6a writes any time row; restore round-trips dates, zones,
  recurrence rules, and every role.
- API keeps `timeDue` / `timeRemind` on `ItemRecord` as projections of the single `due` /
  `remind` row (written with
  `ON CONFLICT (item_uid, role) WHERE role IN ('due', 'remind')`, which matches the
  partial unique index) and adds `times[]`. New multi-valued roles get new role names, never
  a second `due`.
- The current write contract sends only `times[]`; when a request carries `times[]`, it
  is authoritative and any scalar `timeDue`/`timeRemind` in the same request is ignored.
  The scalar rules below apply only to writes without `times[]` (older clients).
- An all-day `due`/`remind` row (`on_date`) has no lossless timestamp form, so its
  projection is `null` and the record also reports it in `times[]`. On write, a non-null
  scalar `timeDue`/`timeRemind` replaces the single row for that role, whatever its
  representation (the client explicitly set a time); `null` clears only a projectable
  row and leaves an all-day row untouched, because an older client sends `null` for a
  value it could not display. Clearing or editing
  an all-day time goes through `times[]`.
- A new time records the device zone (`Intl.DateTimeFormat().resolvedOptions().timeZone`).
  Editing an existing time keeps its stored `time_zone` unless the user explicitly
  picks a different zone, so editing from another zone never shifts how the time or its
  recurrences are interpreted.
- Reminder **delivery** is not in scope; it needs the worker (section 6).

### F7. Table classification guard

`MERGE_TABLE_STRATEGIES` covers tables with an FK to `user_v1`. Extend it so `db:verify`
walks the foreign-key graph and fails unless every table that reaches `user_v1`,
`user_workspace_v1`, or `workspace_item_v1` through any chain of foreign keys (for
example a child of `file_v1` keyed only by `file_id`) declares:

- backup class: `authored` (in portable backups), `derived` (rebuildable, excluded), or
  `account` (bound to specific accounts, never exported: credentials and sessions such
  as `user_api_token_v1`, and `workspace_member`). Restore recreates only the restoring
  user's owner membership; sharing grants are not portable;
- move/merge strategy: `follows-item`, `follows-workspace`, `remap-by-key`, or `drop`.

A fourth backup class, `history`, covers `item_revision`: portable and `follows-item`,
but excluded from revision triggers and from snapshot generation. A fifth, `control`,
covers short-lived protocol state such as `item_mutation_v1`: excluded from backups and
snapshots, not rebuildable, moved with its item (`follows-item`) and dropped with it.
When a merge retires an item into an alias, its receipts are rekeyed to the surviving
item, so a retry sent to the retired UUID resolves through the alias and still replays
its original result.

An `authored` or `history` classification also names the backup format version that
introduced the table and its export and import handlers. A registry-driven round-trip
test fills every portable (`authored` and `history`) table, exports, restores into an empty account, and fails if any table's rows
do not come back, so a classification cannot pass while the backup silently omits the
table.

Polymorphic tables that cannot carry an ordinary foreign key to their targets
(`id_alias_v1`, `sync_tombstone_v1`, `retired_id_v1`) are registered explicitly, and the guard fails on
any table in the `public` schema that is neither reached by the walk nor registered.
`retired_id_v1` records retired `(kind, uid)` pairs with the `item_uid` they belonged to
(for item facets) and the `workspace_uid` they last belonged to; moving an item updates
both on its facets' markers, so they follow it to its new workspace and owner and that workspace's owner at retirement (`owner_user_id`, which an
anonymous merge moves to the permanent account). A portable backup carries every marker
owned by the exported account, including those of workspaces since purged, and restore re-inserts them (skipping any UUID that is live elsewhere), so a
restored account still refuses retries of IDs retired before the backup. Merges leave
it unchanged apart from moving `owner_user_id`. `id_alias_v1` is portable: a backup carries the aliases whose
targets belong to the exported account, and restore recreates them with the same rules
merges use (an alias UUID already in use elsewhere is remapped with its cloned target,
never taken over). Operational tables that hold no user data (the
`schema_migrations_cursor` ledger, and
later the job queue if it lives in `public`) are registered as `operational`, which is
excluded from backups and merges and exempt from the walk.

`drop` is allowed only for `derived` and `account` tables; an `authored` table must use
a lossless strategy. `account` tables that describe a workspace rather than a
credential (`workspace_member`) use `follows-workspace`: memberships move when the
workspace itself moves, and a retiring workspace's memberships are dropped when its
items merge into another workspace (only owner-only workspaces merge, so this drops just
the source owner's row, whose user already owns the destination); credentials use
`drop`. F3 extends the guard to require its revision trigger on
every `authored` + `follows-item` table; F7 does not check that rule, so it ships
independently.
A new content-type table therefore cannot ship without a deliberate backup and merge
decision.

### F8. Client capability modules

`ItemsApp.tsx` is 3,402 lines and `ResultsColumn.tsx` 1,205. Before adding a second
content type:

- Extract the save engine, open-item ring, and workspace/vocabulary state into hooks and
  Zustand stores (`stores/`), leaving `ItemsApp` as composition.
- Add `describeItem(item) → { hasText, hasTimes, hasFiles, … }` in `@lib/db-items/contracts`
  so the web client, API consumers, and agents derive perceived type identically.
- Each capability (text, times, later files/money/status board) is a module with an
  editor control, a compact result-row renderer, and an "add" affordance. The capture
  form shows text first and offers other capabilities without asking the user to pick a
  type.

### F9. Retire note-era compatibility

Per D2 only the web app depends on these, so they go once the web client no longer uses
them and one release has drained previous-release servers:

- API contract 1 (integer IDs) and the pre-F3 `POST`/`PATCH` item routes, once request
  logs show no contract-1 or pre-F3 traffic for 90 days. A tab that wakes up after
  that keeps its dirty draft: the current client never discards an unsaved draft when a
  save fails, and on its next load the storage upgrader converts and saves it;
- legacy SQL views and their insert triggers; the integer reference columns and their
  sync triggers (in the release after the last code using them); the integer `id`
  sequence defaults and `NOT NULL`, so only pre-F9 rows carry a legacy ID; the
  `user_note_v1_id_seq` name, the exact-label unique constraints kept by F1, and F5's
  owner-membership insert and update triggers;
- `/api/notes*` facades, `X-Items-Contract` dual payloads, legacy response aliases,
  `@lib/db-notes`, and the `notesUserId` session field;
- `DB_NOTES_URL` / `DB_NOTES_TEST_URL`, in order: provision `DB_ITEMS_URL` in every
  Railway environment (dev, production, previews), deploy and confirm health while both
  names resolve, then remove the fallback in a later release.

Stays indefinitely: importers for every portable backup version, `id_alias_v1`, open-item storage v1/v2 draft upgraders (a
browser that has not opened the app in months may still hold an unsaved draft), and
`retired_id_v1`, and integer-ID lookups/redirects.

## 6. Additive content types after the foundation

None of these requires changing an existing column. Shapes use `item_id`,
`workspace_id`, and `file_id` for brevity; references to pre-F2 tables are the `*_uid`
columns from F2.

| Capability        | Shape                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Enables                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Item links        | `item_link_v1(workspace_id, from_item_id, to_item_id, kind, position, properties)` with composite FKs `(from_item_id, workspace_id)` and `(to_item_id, workspace_id)`; one-parent partial unique index for `kind='child'`.                                                                                                                                                                                                                                                                                                                                                                                                                                   | Projects, subtasks, wiki links, invoice line items, blog sections, slideshows. |
| Files/media       | `file_v1(id, workspace_id, storage_key='f/<uuid>', content_type, byte_size, sha256, original_name, width, height, duration_ms, status)` + `item_file_v1(workspace_id, item_id, file_id, role, position)` with composite FKs `(item_id, workspace_id)` → item and `(file_id, workspace_id)` → file, so an item can never attach another workspace's file. Storage keys never contain user/workspace IDs, so merges never touch the bucket. The portable backup version that introduces files carries the bytes (an archive with the JSON plus each object, verified by `sha256` on restore), and the F7 round-trip test checks restored bytes, not only rows. | Images, video, receipts, attachments, covers.                                  |
| Board position    | `position text` (fractional index) on the status link, or `item_link` to a board item.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Kanban columns per workspace or per project.                                   |
| Money             | `item_amount_v1(item_id, role, amount_minor bigint, currency char(3), occurred_on date, description)`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Invoices, receipts, budgets.                                                   |
| Time tracking     | `item_time_v1` rows with `role='session'` and start/end.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Timesheets, billable time.                                                     |
| Publishing        | `site_v1(id, workspace_id, host)` with a unique index on the normalized host + `publication_v1(workspace_id, site_id, item_id, path, published_revision, published_at, visibility)` with composite FKs `(site_id, workspace_id)` → site and `(item_id, workspace_id)` → item, and `UNIQUE (site_id, path)`.                                                                                                                                                                                                                                                                                                                                                  | Blog/CMS.                                                                      |
| Reminder delivery | Postgres-backed worker (graphile-worker or pg-boss) + `notification_v1`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Reminders that fire; embeddings off the request path; trash purge.             |
| Properties        | `properties jsonb` with namespaced keys (`task.priority`); promote to a typed table once a key needs constraints, indexes, or joins.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Lightweight per-app fields.                                                    |
| Title             | Nullable `title`; derived from the first line when null.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Posts, tasks with separate body.                                               |
| Embeddings        | `item_embedding_v1(item_id, model, chunk, content_hash, embedding)`, backfilled from the inline column.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Model upgrades, long-text chunking.                                            |

## 7. Not in this plan

- Replacing Auth.js v5 beta (Better Auth or similar) is worthwhile but independent of
  data extensibility; plan it separately.
- A sync engine (PowerSync, Electric, Zero). F2–F4 make the schema compatible with one.
- Unifying categories/statuses/tags into one term table. Additive vocabularies can be new
  tables or a later forward migration; nothing is lost by waiting.

## 8. Verification for each phase

- Migration tested against a populated pre-migration database (pattern:
  `testing/item-rename-migration.test.ts`), asserting row counts, preserved text and
  timestamps, link integrity, and that legacy IDs still resolve.
- `pnpm run db:migrate`, `pnpm run db:verify`, `pnpm --filter @lib/db-items test`,
  web tests and build, `pnpm run release:notes:prepare`; generated artifacts committed.
- After promotion: pre-deploy migration success and app health per
  `docs/operations/notes-environments.md`.

## 9. Product decisions

- **D1. Existing data.** Everything is preserved in place. Legacy integer item URLs keep
  redirecting to UUID URLs; dirty browser drafts are upgraded, never discarded.
- **D2. Clients.** Only the current web app calls the API. F9 runs as soon as the web
  client no longer depends on the compatibility layer; the API does not need to accept
  integer IDs beyond the `?id=` redirect and the browser-storage upgrader.
- **D3. Delete.** Deleted items go to a Trash view with restore and are purged
  automatically after 30 days.
- **D4. Edit conflicts.** Keep both: the later save wins on screen, the overwritten version
  is saved to the item's history, and the user is notified so they can restore or copy
  from it. No blocking merge dialog.
- **D5. Sharing.** Workspaces will be shared eventually, so F5 (membership) is part of
  the foundation; no sharing UI yet.
- **D6. Label casing.** Labels display as typed; uniqueness is case- and
  Unicode-normalization-insensitive ("NYC" and "nyc" are the same category).

## 10. Delivery order

F1a → F1b (next release) → F7 (guard first, so every following table is classified) → F2-pre → F2a → F2b (next
release) → F3a → F3b → F4a → F4b → F4c (each the next release) → F5a → F5b (next release) → F8 → F6a → F6b → F6c → F6d (each the next release) → F9.

F8 lands before F6 so the time facet is built as the first capability module rather than
added to `ItemsApp.tsx` and extracted again.
