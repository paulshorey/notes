---
name: Extensible item core — settle the hard-to-change foundation in place, then add content types additively
overview: Before any content type beyond text ships, settle the parts of the item model that become expensive or destructive to change once more tables, clients, URLs, and devices depend on them — permanent IDs, lossless input, revisioned idempotent writes, soft delete, membership ownership, and a time facet. Every step is a forward, in-place migration applied by the existing Railway pre-deploy, so no database reset and no data export/import is ever required. After the foundation, every planned content type (reminders, schedules, files, media, money, kanban, time tracking, publishing, sharing) is an additive table plus a client capability module.
todos:
  - id: lossless_input
    content: "F1. Store authored text exactly as typed and labels as typed with a normalized key for uniqueness. Stops ongoing data loss; small and independent."
    status: pending
  - id: permanent_ids
    content: "F2. Convert item, workspace, vocabulary, and link keys to UUIDs in place, keeping the old integer as a unique legacy_id for old URLs, drafts, and backups. Merge and restore move rows instead of copying them."
    status: pending
  - id: revisioned_writes
    content: "F3. Client-generated UUIDv7 IDs, PUT /api/items/{id} idempotent upsert with baseRevision (409 on conflict), a coalesced item_revision history, and a change_seq sync cursor. Replaces the client's create-versus-update split."
    status: pending
  - id: soft_delete
    content: "F4. deleted_at on items with trash/restore and a purge path; every read filters deleted rows; deletions are visible to sync as tombstones."
    status: pending
  - id: membership
    content: "F5. workspace_member(workspace_id, user_id, role); every authorization check becomes one membership predicate. Owner rows are backfilled."
    status: pending
  - id: time_facet
    content: "F6. item_time (many per item: role, instant or local date, IANA zone, RRULE) replaces time_due/time_remind; the client records the user's time zone."
    status: pending
  - id: registry_guard
    content: "F7. Generalize the merge registry guard: db:verify fails unless every table reaching an item or workspace is classified for backup (authored or derived) and for move/merge."
    status: pending
  - id: client_capabilities
    content: "F8. Split ItemsApp.tsx along capability boundaries; derive an item's perceived type from the facets it has, and render each facet with its own module."
    status: pending
  - id: retire_compat
    content: "F9. Retire the note-era compatibility layer once its clients are confirmed drained: legacy views, user_note_v1_id_seq name, /api/notes facades, X-Items-Contract dual payloads, DB_NOTES_URL, and @lib/db-notes."
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

| # | Today | Why it hurts later | Cost if deferred |
| --- | --- | --- | --- |
| 1 | `integer` serial IDs; anonymous merge into an existing same-named workspace (the usual case: every account has `personal`) and backup restore **copy items under new IDs** (`sql/user/anonymous.ts`, `sql/user/backup.ts`). | Every future reference to an item — file attachments, item links, subtasks, kanban positions, public post URLs, reminders, offline device copies — breaks on merge or restore. | Changing a key type rewrites every referencing table, URL, storage key, and backup format. Grows with each new table. |
| 2 | Server allocates IDs; the client separates create (POST) from update, with careful no-retry handling. Saves are last-write-wins with no revision. | Multiple devices, offline capture, voice transcription arriving late, and collaborators all silently overwrite each other. | Every new client (mobile, API, agent) re-implements the race handling. |
| 3 | Hard delete. | No trash or undo; no tombstones for devices to learn about deletions; deleting a parent item later (project, invoice) destroys children irrecoverably. | Every query written before soft delete must be revisited to add the filter. |
| 4 | Ownership is `user_workspace_v1.user_id`, checked by every query. | Sharing a board with a partner, team, or client is impossible without touching every authorization query. | Linear in the number of queries; grows with every content type. |
| 5 | `time_due` / `time_remind` are single `timestamptz` columns from a `datetime-local` input. | No time zone, no all-day vs timed, no recurrence, one of each per item. Schedules, reminders, calendars, and time tracking all need many times per item. | Information the user meant is lost on every write and cannot be reconstructed. |
| 6 | Text is trimmed on write (`toNullableText`); labels are lowercased by check constraints. | Markdown/code whitespace is altered; "NYC", "iOS", "Q3 Plan" cannot be displayed as typed — this matters once categories become blog sections or kanban columns. | Lost on every write; unrecoverable. |

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
8. **Authorization is one membership predicate.**
9. **Every table is classified** for backup and move/merge, enforced by `db:verify`.
10. **Workspace is the sharing boundary, not a project.** Projects, boards, invoices,
    and posts are items related through `item_link`.

## 5. Foundation phases

Each phase is one PR, independently releasable through the normal `main` → `prod` flow,
with migrations applied by Railway pre-deploy. Each keeps the web client working.

### F1. Lossless input (small, first — it stops data loss today)

- Items: store `description` exactly as received. Blank-or-whitespace text is still "no
  text" for `isTextItem`, search, and embeddings; the stored value is not modified.
- Workspaces, categories, statuses, tags: add `label_key` (`lower(normalize(btrim(label),
  NFKC))`), move uniqueness and the reserved-name check to `label_key`, and drop the
  lowercase check. Existing labels keep their current (lowercase) text; new and renamed
  labels keep the casing typed.
- Merge, restore, backup, and `resolve*` helpers match by `label_key`.

### F2. Permanent IDs, in place

Migration (single transaction, forward-only, no reset):

1. Add `app_uuid_v7()` (SQL; replaced by native `uuidv7()` when the database runs
   PostgreSQL 18) and a `uuid` column to each authored table, backfilled.
2. Add uuid FK columns to link tables, backfill by join, swap primary/foreign keys and
   composite workspace FKs to the uuid columns, rename integer `id` → `legacy_id`
   (unique, kept for lookups). Drop `serial` defaults on `legacy_id` for new rows.
3. Existing compatibility views that expose integer `id`/`note_id` are dropped in F9 or
   rewritten to read `legacy_id`; per D2 they are dropped.

Code:

- Contracts change `id: number` → `id: string` for items, workspaces, and vocabulary.
- `GET /api/items/{id}` and open-item URLs accept either a UUID or a legacy integer and
  redirect to the UUID form.
- Browser storage v4 upgrader maps integer IDs in cached items and dirty drafts to UUIDs
  through a lookup endpoint; dirty drafts are never discarded on failure.
- Anonymous merge **moves** items (`UPDATE … SET workspace_id`) into the destination
  workspace and remaps vocabulary links by `label_key`, instead of copying under new
  IDs. Deduplication by content signature remains for identical items.
- Backup v3 carries UUIDs; restore preserves them (conflicting UUIDs in another account
  are rejected, never reassigned). Importers for v1/v2 remain.

### F3. Revisioned, idempotent writes and a sync cursor

- `workspace_item_v1.revision bigint NOT NULL DEFAULT 1`, bumped by trigger.
- Global `change_seq` sequence; items, workspaces, vocabulary rows, and link changes bump
  the owning item's `change_seq` so the item is the sync unit.
- `PUT /api/items/{id}` upserts by client-generated UUIDv7 with `baseRevision`; a stale
  revision returns `409` with the server copy; the client keeps its edit on screen, the
  server stores the overwritten version in `item_revision`, and the user is notified (D4).
- `item_revision` keeps coalesced snapshots (per editing burst, and always before a
  conflicting overwrite, delete, or merge).
- `GET /api/items?since=<change_seq>` returns changed items and tombstones.
- The client save engine drops the create/update split and the POST no-retry hazard:
  every save is a retryable PUT.

### F4. Soft delete and trash

- `deleted_at timestamptz` on items (and later on facets that can be removed alone).
- All reads filter `deleted_at IS NULL`; partial indexes keep this cheap.
- Delete moves to trash; restore clears it; purge after 30 days (D3).
  Purge runs from a maintenance command until a background worker exists.

### F5. Membership ownership

- `workspace_member(workspace_id, user_id, role CHECK (role IN ('owner','editor','viewer')))`,
  backfilled with one `owner` per existing workspace. `user_workspace_v1.user_id` is
  kept as the creator until F9, then dropped.
- One SQL predicate (`can_read_workspace` / `can_write_workspace`) replaces per-query
  ownership joins.
- Anonymous link becomes a membership move when the destination has no same-named
  workspace, and an item move (F2) when it does.
- No sharing UI is built in this phase; roles other than `owner` stay unused until
  sharing is designed (D5).

### F6. Time facet

```sql
CREATE TABLE item_time_v1 (
  id uuid PRIMARY KEY DEFAULT app_uuid_v7(),
  item_id uuid NOT NULL, workspace_id uuid NOT NULL,
  role text NOT NULL,               -- 'due' | 'remind' | 'start' | 'end' | 'event' | ...
  at timestamptz,                   -- a specific instant
  on_date date,                     -- an all-day / floating date
  end_at timestamptz, end_date date,
  time_zone text,                   -- IANA zone the user meant
  rrule text,                       -- RFC 5545 recurrence
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (at IS NOT NULL OR on_date IS NOT NULL),
  FOREIGN KEY (item_id, workspace_id) REFERENCES workspace_item_v1(id, workspace_id)
    ON DELETE CASCADE ON UPDATE CASCADE
);
```

- Backfill `due` / `remind` rows from the existing columns (`time_zone` NULL: unknown).
- API keeps `timeDue` / `timeRemind` on `ItemRecord` as derived fields for the text
  client and adds `times[]`; the columns are dropped one release later.
- The client sends `Intl.DateTimeFormat().resolvedOptions().timeZone` with every time.
- Reminder **delivery** is not in scope; it needs the worker (section 6).

### F7. Table classification guard

`MERGE_TABLE_STRATEGIES` covers tables with an FK to `user_v1`. Extend it so `db:verify`
fails unless every table with a `workspace_id` or `item_id` column declares:

- backup class: `authored` (in portable backups) or `derived` (rebuildable, excluded);
- move/merge strategy: `follows-item`, `follows-workspace`, `remap-by-key`, or `drop`.

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

Remove the legacy views, the `user_note_v1_id_seq` name, `/api/notes*` facades,
`X-Items-Contract` dual payloads and legacy response aliases, `DB_NOTES_URL` /
`DB_NOTES_TEST_URL`, `@lib/db-notes`, the `notesUserId` session field, and v1/v2
open-item storage upgraders. Per D2 only the web app depends on them.
Backup v1/v2 importers stay.

## 6. Additive content types after the foundation

None of these requires changing an existing column.

| Capability | Shape | Enables |
| --- | --- | --- |
| Item links | `item_link_v1(from_item_id, to_item_id, kind, position, properties)`; one-parent partial unique index for `kind='child'`. | Projects, subtasks, wiki links, invoice line items, blog sections, slideshows. |
| Files/media | `file_v1(id, workspace_id, storage_key='f/<uuid>', content_type, byte_size, sha256, original_name, width, height, duration_ms, status)` + `item_file_v1(item_id, file_id, role, position)`. Storage keys never contain user/workspace IDs, so merges never touch the bucket. | Images, video, receipts, attachments, covers. |
| Board position | `position text` (fractional index) on the status link, or `item_link` to a board item. | Kanban columns per workspace or per project. |
| Money | `item_amount_v1(item_id, role, amount_minor bigint, currency char(3), occurred_on date, description)`. | Invoices, receipts, budgets. |
| Time tracking | `item_time_v1` rows with `role='session'` and start/end. | Timesheets, billable time. |
| Publishing | `site_v1(id, workspace_id, host)` + `publication_v1(site_id, item_id, path, published_revision, published_at, visibility)`. | Blog/CMS. |
| Reminder delivery | Postgres-backed worker (graphile-worker or pg-boss) + `notification_v1`. | Reminders that fire; embeddings off the request path; trash purge. |
| Properties | `properties jsonb` with namespaced keys (`task.priority`); promote to a typed table once a key needs constraints, indexes, or joins. | Lightweight per-app fields. |
| Title | Nullable `title`; derived from the first line when null. | Posts, tasks with separate body. |
| Embeddings | `item_embedding_v1(item_id, model, chunk, content_hash, embedding)`, backfilled from the inline column. | Model upgrades, long-text chunking. |

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

F1 → F7 (guard first, so every following table is classified) → F2 → F3 → F4 → F6 →
F5 → F8 (can run in parallel with F3 onward) → F9.
