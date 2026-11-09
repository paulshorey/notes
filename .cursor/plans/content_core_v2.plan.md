---
name: Content core v2 — permanent item identity, capability facets, sync-ready writes
overview: One deliberate destructive reset while there are no users. Replace integer IDs with client-generated UUIDv7, make the item a narrow permanent shell whose perceived type is derived from optional capability facets, store user intent losslessly (text, label casing, local dates and time zones), make every write idempotent and revisioned, soft-delete with tombstones, move ownership to workspace membership, replace the beta Auth.js stack, and drop the note-era compatibility layer. After this cut, every planned feature (reminders, schedules, money, files, media, publishing, sharing) is an additive migration.
todos:
  - id: inventory
    content: Read-only row counts per environment (dev, production, previews); confirm the only real data is the developer's own. Export portable backups per permanent account and a retained admin SQL backup.
    status: pending
  - id: schema
    content: New baseline migration set for the v2 core tables below; runner fails closed on a legacy schema_migrations_cursor ledger unless an explicit reset is requested and confirmed.
    status: pending
  - id: services
    content: Rewrite lib/db-items SQL/services for UUIDs, membership authorization, term vocabularies, item_time, revisions, soft delete, change_seq, and the move/merge registry.
    status: pending
  - id: backup
    content: Backup format version 3 for the v2 tables; keep importers for versions 1 and 2 as the bridge for existing data. db:verify fails on any workspace-owned table not classified for backup and merge.
    status: pending
  - id: api_client
    content: PUT /api/items/{id} idempotent upsert with baseRevision (409 on conflict), GET ?since=<change_seq> incremental sync, trash/restore; simplify the client save engine (no create-vs-update split, no POST retry hazard).
    status: pending
  - id: auth
    content: Replace Auth.js v5 beta with Better Auth (anonymous plugin, email/password, later magic link/phone OTP/passkeys); anonymous → permanent is a membership move in onLinkAccount, never an item copy.
    status: pending
  - id: worker
    content: Add a Postgres-backed job runner service (graphile-worker or pg-boss) for embeddings off the request path, reminder delivery, trash purge, and anonymous-user cleanup.
    status: pending
  - id: remove_compat
    content: Remove note-era compatibility views, the legacy sequence name, /api/notes facades, X-Items-Contract dual payloads, legacy response aliases, DB_NOTES_URL, and the @lib/db-notes command adapter.
    status: pending
  - id: reset
    content: Reset dev, deploy, import backups, verify; then the same for production in one planned window. Recreate previews.
    status: pending
isProject: true
---

# Content core v2

## Status: proposed (not started)

## 1. Verdict on the current stack

| Layer | Verdict | Action |
| --- | --- | --- |
| PostgreSQL + pgvector | Right foundation: JSONB, FTS, vectors, triggers, logical replication for future sync engines. | Keep. |
| Database-first SQL, generated types, `verify-contract.mjs`, merge-registry guard | Strong discipline; keep it. | Keep; generalize the guard (section 5). |
| Next.js App Router for UI + REST | Adequate for web and API. | Keep. Domain logic stays in `lib/db-items`. |
| Background work | Missing. Reminders are stored but never fire; Jina embedding calls run inside save requests. | Add a worker service on Postgres-backed jobs. |
| Auth.js / NextAuth v5 | Never left beta; now in security-only maintenance under Better Auth. | Replace with Better Auth during the identity reset. |
| Client save engine | Large hand-rolled race handling exists because the server allocates IDs (create vs update, "never retry a POST"). | Client-generated IDs + idempotent PUT + revision removes the root cause. |
| Sync engine (PowerSync / Electric / Zero) | Not needed yet. | Make the schema sync-ready now (UUIDs, change_seq, tombstones) so one can be adopted later without migration. |
| UI kits / editors | Gravity UI + Mantine; CodeMirror (atomic-editor), TipTap, and Gravity markdown editor. | Not a schema concern; consolidate separately. |

## 2. What in the current schema would force destructive migrations later

1. **Integer serial IDs.** Item IDs change on restore and on anonymous merge whenever the
   destination already has a workspace with the same label — the usual case, since every
   account starts with `personal` (rows are copied with new `nextval` IDs). That breaks `?id=` URLs, open-item rings, future item links,
   file references, share/public URLs, and any device's local copy. Changing a primary-key
   type later rewrites every referencing table, URL, storage key, and backup.
2. **Lossy time.** `time_due` / `time_remind` are bare `timestamptz` from `datetime-local`.
   The user's time zone, all-day vs timed, and recurrence are not recorded and cannot be
   reconstructed. One due and one reminder per item is also too few for schedules.
3. **Lossy labels.** Category, tag, status, and workspace labels are stored lowercased.
   Display casing ("NYC", "iOS", "Q3 Plan") is discarded permanently, which matters as
   soon as categories become website sections or headings.
4. **Lossy text.** `toNullableText` trims authored text on write.
5. **Hard delete.** Deleted items are gone: no trash, no undo, no tombstones for sync.
6. **Silent last-write-wins.** No revision check across tabs/devices; one device overwrites
   another's edit with no history to recover it.
7. **Ownership is `user_workspace_v1.user_id`.** Sharing, collaboration, and cheap
   anonymous merges all need membership; today every authorization query hardcodes owner.
8. **Case-sensitive identity uniqueness.** Only exact `UNIQUE(username)`; email/phone
   uniqueness relies on advisory locks and application checks.
9. **Embeddings inline with fixed `vector(1024)`.** One model, one vector per item, no
   chunking; a model with different dimensions needs a schema change.

Everything else planned (files, money, contacts, places, publishing, slideshows) can be
added later without data loss *if* items 1–7 are settled first.

## 3. Rules that keep the core stable

1. **Identity is permanent.** Every row uses a UUIDv7 generated by the client (or server
   fallback). IDs never change on move, merge, or restore, and never encode ownership.
2. **No type discriminator.** An item's perceived type is derived from what it has:
   body text, times, files, amounts, links, properties. Clients render by capability.
3. **Capabilities are additive.** A new capability is a new facet table keyed by
   `item_id` (1:1 or 1:N) or a namespaced key in `item.properties`. Never repurpose or
   reinterpret an existing column. Promote a property into a typed table when it needs
   constraints, indexes, or joins; copy, dual-read until backfilled, then switch.
4. **Store intent losslessly.** Text exactly as typed; labels as typed plus a normalized
   key; local date vs instant plus IANA zone plus RRULE; money as integer minor units plus
   ISO currency; original file bytes plus metadata.
5. **No hard delete in the request path.** `deleted_at` → trash → purge job.
6. **Every write is idempotent and revisioned.** `PUT` by client ID; `baseRevision`
   mismatch returns 409 with the server copy; revision snapshots back up overwrites.
7. **Derived data is disposable and versioned.** Embeddings, search vectors, thumbnails,
   extracted text, and transcripts are keyed by model/version and rebuildable.
8. **Ownership through workspace membership.** Every user-authored row reaches a
   workspace; authorization is one membership predicate.
9. **Every authored table is classified.** `db:verify` fails unless each table with
   `workspace_id` is declared for backup (authored vs derived) and for move/merge.
10. **Provenance on writes.** `created_by`, `updated_by`, and `source` (web, android, api,
    email, sms, import, agent).

## 4. Target schema (sketch)

Plain table names; versioning lives in migrations. IDs are UUIDv7 from the app. Until the
Railway database runs PostgreSQL 18 (native `uuidv7()`), defaults use a local
`app_uuid_v7()` SQL function named to avoid clashing with the native one.

```sql
-- Auth tables are owned by Better Auth (user, session, account, verification),
-- configured with UUID ids. "user" gains is_anonymous via the anonymous plugin.
-- Email uniqueness is case-insensitive (lower() unique index / lowercased on write).

CREATE SEQUENCE change_seq;  -- global, monotonic sync cursor

CREATE TABLE workspace (
  id uuid PRIMARY KEY DEFAULT app_uuid_v7(),
  name text NOT NULL,                       -- as typed
  name_key text NOT NULL,                   -- lower(normalize(btrim(name), NFKC))
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  change_seq bigint NOT NULL
);

CREATE TABLE workspace_member (
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner','editor','viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);
-- A user's workspace names are unique among workspaces they own: enforced in the
-- service (names live on workspace, ownership on member).

CREATE TABLE item (
  id uuid PRIMARY KEY,                      -- client-generated
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  title text,                               -- optional; derived from body when null
  body text,                                -- exactly as typed
  body_format text NOT NULL DEFAULT 'markdown',
  properties jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(properties) = 'object'),
  revision bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),   -- may accept bounded client time
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  created_by uuid, updated_by uuid,
  source text NOT NULL DEFAULT 'web',
  change_seq bigint NOT NULL,
  search_vector tsvector GENERATED ALWAYS AS
    (to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(body,''))) STORED,
  UNIQUE (id, workspace_id)
);
-- indexes: (workspace_id, updated_at DESC) WHERE deleted_at IS NULL; (change_seq);
-- GIN(search_vector); GIN(properties jsonb_path_ops)

-- One vocabulary table replaces category/status/tag tables; new vocabularies are data.
CREATE TABLE term (
  id uuid PRIMARY KEY DEFAULT app_uuid_v7(),
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  vocabulary text NOT NULL,                 -- 'category' | 'tag' | 'status' | future
  label text NOT NULL,                      -- as typed
  label_key text NOT NULL,                  -- normalized for uniqueness
  position text,                            -- fractional index for manual order
  properties jsonb NOT NULL DEFAULT '{}',   -- color, icon, page item id, ...
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  change_seq bigint NOT NULL,
  UNIQUE (workspace_id, vocabulary, label_key),
  UNIQUE (id, workspace_id, vocabulary)
);

CREATE TABLE item_term (
  item_id uuid NOT NULL,
  term_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  vocabulary text NOT NULL,
  position text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, term_id),
  FOREIGN KEY (item_id, workspace_id) REFERENCES item(id, workspace_id)
    ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE,
  FOREIGN KEY (term_id, workspace_id, vocabulary) REFERENCES term(id, workspace_id, vocabulary)
    ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE
);
-- single-valued vocabularies: CREATE UNIQUE INDEX ... ON item_term(item_id, vocabulary)
--   WHERE vocabulary IN ('status');  (extend the list non-destructively)

-- Generic directed edges: wiki links, parent/child (pages, slides, line items, subtasks),
-- "about" (reminder about an item), "person"/"place" references.
CREATE TABLE item_link (
  id uuid PRIMARY KEY DEFAULT app_uuid_v7(),
  workspace_id uuid NOT NULL,
  from_item_id uuid NOT NULL,
  to_item_id uuid NOT NULL,
  kind text NOT NULL,
  position text,
  properties jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (from_item_id, workspace_id) REFERENCES item(id, workspace_id)
    ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE,
  FOREIGN KEY (to_item_id, workspace_id) REFERENCES item(id, workspace_id)
    ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE,
  UNIQUE (from_item_id, to_item_id, kind)
);
-- one parent per child: UNIQUE (to_item_id) WHERE kind = 'child'

-- Time facet; replaces time_due/time_remind. Many per item.
CREATE TABLE item_time (
  id uuid PRIMARY KEY DEFAULT app_uuid_v7(),
  item_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  role text NOT NULL,                       -- 'due' | 'start' | 'end' | 'event' | 'remind' | ...
  at timestamptz,                           -- a specific instant
  on_date date,                             -- an all-day / floating date
  end_at timestamptz, end_date date,        -- ranges
  time_zone text,                           -- IANA zone the user meant
  rrule text,                               -- RFC 5545 recurrence
  next_fire_at timestamptz,                 -- computed by the worker for reminders
  properties jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (at IS NOT NULL OR on_date IS NOT NULL),
  FOREIGN KEY (item_id, workspace_id) REFERENCES item(id, workspace_id)
    ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE
);
-- index: (next_fire_at) WHERE next_fire_at IS NOT NULL

-- Content history; coalesced (e.g. at most one snapshot per item per few minutes of
-- editing, plus before every conflicting overwrite, delete, and merge).
CREATE TABLE item_revision (
  item_id uuid NOT NULL REFERENCES item(id) ON DELETE CASCADE,
  revision bigint NOT NULL,
  title text, body text, body_format text NOT NULL, properties jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, source text,
  PRIMARY KEY (item_id, revision)
);

-- Derived; rebuildable. Untyped vector + per-model partial expression HNSW indexes
-- lets two models coexist during a migration and supports chunked long notes.
CREATE TABLE item_embedding (
  item_id uuid NOT NULL REFERENCES item(id) ON DELETE CASCADE,
  model text NOT NULL,
  chunk int NOT NULL DEFAULT 0,
  content_hash bytea NOT NULL,              -- skip re-embedding unchanged text
  embedding vector NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, model, chunk)
);
-- CREATE INDEX ... USING hnsw ((embedding::vector(1024)) vector_cosine_ops)
--   WHERE model = 'jina-embeddings-v5-text-small:notes-v3';
```

Triggers set `updated_at` and `change_seq = nextval('change_seq')` on every insert/update
of `workspace`, `item`, `term`. Any change to an item's terms, links, or times also
touches the item (bumps `revision` and `change_seq`), so the item is the sync unit.

## 5. First additive extensions (not part of the reset)

Each lands as a new table or properties namespace, with its backup/merge classification.

- **Files/media** (the `media` bucket exists): `file(id, workspace_id, storage_key =
  'f/<file uuid>', content_type, byte_size, sha256, original_name, width, height,
  duration_ms, status, created_by, created_at, deleted_at, properties)` and
  `item_file(item_id, file_id, role 'attachment'|'cover'|'inline', position)`. Storage keys
  never contain user or workspace IDs, so merges and moves never touch the bucket.
- **Money:** `item_amount(item_id, role, amount_minor bigint, currency char(3), occurred_on
  date, ...)`; invoices/receipts are items with `child` line items. Never floats.
- **Publishing/website:** `site(id, workspace_id, host)` and `publication(site_id, item_id,
  path, published_revision, published_at, visibility)`. Public URLs use slugs or UUIDs.
- **Sharing:** more `workspace_member` roles and invitations; no schema rework.
- **Reminder delivery:** `notification(id, item_time_id, channel, scheduled_for, sent_at,
  status)` written by the worker; Resend/Twilio already configured.
- **People/places:** items with properties plus `item_link` references.

## 6. Anonymous and permanent users

Anonymous users are ordinary users with no credential. Better Auth's anonymous plugin
creates the user; signing up or signing in calls `onLinkAccount({ anonymousUser, newUser })`.
Because items have permanent UUIDs and ownership is membership, linking is:

1. For each workspace the anonymous user owns: if the destination owns a workspace with
   the same `name_key`, move items into it (`UPDATE item SET workspace_id`, deferred FKs)
   and remap `item_term` to the destination's terms by `(vocabulary, label_key)`, creating
   missing terms; otherwise move the membership row.
2. Merge preferences with the existing recursive anon-wins rule.
3. Delete the anonymous user.

No item is copied, so IDs, URLs, open drafts, files, and links survive. Sign-up and
sign-in take the same path. The move/merge registry guard stays, keyed on `workspace_id`.

## 7. Removed in the same cut

Compatibility views and the `user_note_v1_id_seq` name; `/api/notes*` facades;
`X-Items-Contract` dual payloads and legacy response aliases; `DB_NOTES_URL` /
`DB_NOTES_TEST_URL`; `@lib/db-notes`; open-item storage upgraders for v1/v2 (after
confirming no browser holds dirty legacy drafts); `notesUserId` session field; claim
advisory locks (replaced by unique indexes). The old 25-migration history is replaced
by a new baseline. Backup importers for versions 1 and 2 stay as the data bridge.

## 8. Reset procedure (fail closed)

1. Read-only inventory of each environment: row counts per table, permanent accounts.
2. Export each permanent account's portable backup and take a retained admin SQL backup.
3. The new migration runner refuses to run when it finds the legacy
   `schema_migrations_cursor` ledger, so a Railway pre-deploy can never reset a database
   implicitly. Reset is an explicit operator command with a typed confirmation.
4. Dev: reset → deploy → import backups → verify counts and spot-check items.
5. Production: same, once, in a planned window, after dev has run cleanly.
6. Previews: recreate from the new baseline.

## 9. Delivery order

1. Schema + `lib/db-items` services + backup v3 with v1/v2 importers + tests.
2. Better Auth on the new identity tables; anonymous link flow (section 6).
3. API v2 (PUT upsert, `baseRevision`, `?since=`, trash) and client save-engine
   simplification.
4. Worker service: embeddings off the request path, `item_time` reminders, trash purge,
   anonymous cleanup.
5. Compatibility removal and documentation rewrite, then the production reset.
