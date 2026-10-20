# Item core and the text-focused Notes client

An **item** is the workspace-owned persistent unit. A **note** is an item with
nonblank authored text, presented by the current text-focused web client. Adding
future dates, files, contacts, financial information, or task properties will
extend an item without converting it into another exclusive type.

## This refactor

The canonical package is `@lib/db-items` in `lib/db-items`. Shared records,
services, SQL, generated contracts, and generic client state use item terminology.
The web app remains `notes-next`, with the same note editor, autosave behavior,
categories, statuses, tags, authentication, and user-facing wording.

`workspace_item_v1` is the former `user_note_v1` table, renamed in place. Existing
integer IDs, text, timestamps, dates, vectors, vocabulary IDs, and relationships
are preserved. Category/status/tag vocabulary is workspace-scoped; category and
tag link tables now reference `item_id`. Composite foreign keys still reject
cross-workspace relationships. `description` remains nullable in this first step.
`isTextItem` is the explicit selection rule for the current note client.

This change does not introduce exclusive item types, split text into a companion
table, add UUIDs/revision checks, change scheduling, or implement attachments,
money, contacts, tasks, project management, or agent workflows. Those are separate
design and implementation steps. Text can become a companion capability later
without changing the meaning of the item identity established here.

## Canonical contracts

New data routes are `/api/items`, `/api/items/search`, and
`/api/items/maintenance/embeddings`. Payloads use `item`, `items`, `itemId`,
`itemCount`, `itemsImported`, and `itemsSkipped`. The backend accepts nullable or
omitted text. The current capture form still requires nonblank text.

The new web client sends `X-Items-Contract: 1` to select item-only payloads on
shared routes such as bootstrap, vocabulary, and backup. Common routes without
that header include legacy field aliases for older loaded browser builds. The
`/api/notes` compatibility facade translates old requests and responses at the
HTTP boundary; it calls the same authenticated item service and database rows.
Compatibility never makes a client-supplied user ID authoritative.

## Existing data and clients

- Forward migration `202610201800__rename_notes_to_items.sql` renames physical
  tables, columns, constraints, indexes, vocabulary sequences, and triggers.
  Immutable earlier migration files are moved with the package unchanged.
- Six simple, automatically updatable views retain the old SQL table names
  while old servers drain. They expose the same rows, including old `note_id`
  column names on link views. They are excluded from generated canonical types.
- The single existing `user_note_v1_id_seq` keeps its name temporarily because
  old account-merge SQL calls it literally. New code discovers the owning
  sequence with `pg_get_serial_sequence`; no competing allocator is created.
- Backup version 2 uses `workspaces[].items`. Import still accepts version 1's
  `workspaces[].notes`, with the existing reserved-category conversion. Older
  web clients download version 1 when they omit the item-contract header.
- Browser cache and open-item storage use version 3. Readers upgrade existing
  note-named snapshots, including serialized IDs and clean/dirty signatures.
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

Run `pnpm run db:migrate` and `pnpm run db:verify` against an isolated database,
`DB_ITEMS_TEST_URL=... pnpm --filter @lib/db-items test`, and
`pnpm run release:notes:prepare`. Keep generated artifacts committed.

Regression coverage includes a populated pre-rename database upgraded through the
real forward migration, table identity and exact row preservation, old/new writes
sharing one ID sequence, vocabulary upserts through compatibility views, nullable
text persistence, version-one backups, legacy API authentication, signed-session
identity, and browser draft/signature migration. Local checks establish compatibility,
not deployment or live production acceptance.
