---
name: Independent taxonomy values
overview: Replace the parent-owned Epic > Category > Group tree with three reusable per-user vocabularies. Each note will persist one epic, one category, and one group independently; the UI will derive a navigation hierarchy from note assignments. Roll the change out additively so the live web app, old browser drafts, anonymous-account merges, and the experimental Android client remain recoverable through the cutover.
todos:
  - id: characterize_current_state
    content: Add migration fixtures and read-only production preflight queries that capture duplicate labels under different parents, note paths, defaults, and invalid/orphan counts before changing schema.
    status: pending
  - id: expand_schema
    content: Add canonical user_taxonomy_value_v1 rows, independent note value columns, legacy group-to-selection remaps, backfill/deduplicate logic, constraints, indexes, schema assertions, and generated artifacts without removing the live tree.
    status: pending
  - id: transitional_backend
    content: Update contracts, SQL, services, APIs, counts, deletion, defaults, embeddings, and anonymous merge to use independent values while temporarily dual-writing the legacy group path for rollback and old-client compatibility.
    status: pending
  - id: web_cutover
    content: Store epic/category/group ids in every draft, make all three selectors global and independent, derive sidebar groups from note assignments, upgrade URLs/caches/open drafts, and remove reparent/path assumptions.
    status: pending
  - id: android_cutover
    content: Update the Android contract, persistence, request/response codecs, repository, filters, widgets, and editing UI to carry all three independent ids; keep server compatibility until the replacement APK is available.
    status: pending
  - id: cleanup_release
    content: After all writers use independent values, deploy code that no longer reads the legacy tree, then drop the old tree/group column and obsolete endpoints in a separate forward-only cleanup migration while retaining the legacy draft remap for the agreed support horizon.
    status: pending
  - id: verify_and_deploy
    content: Run DB, service, web, Android, build, manual persistence, and production rollout checks; update AGENTS.md and the PR handoff with exact files, decisions, results, rollout state, and remaining cleanup gates.
    status: pending
isProject: false
---

# Independent Epic, Category, and Group values

## Status

Proposed on 2026-09-06. No implementation has started.

This plan supersedes the data-model assumptions in
`.cursor/plans/taxonomy-frontend-handoff.md`. That handoff remains useful for
the open-note ring, autosave, cache, and UI history, but its strict tree and
leaf-only `groupId` invariants are intentionally replaced here.

Related shipped history:

- PR #70 introduced the strict Epic > Category > Group tree and `group_id`.
- PR #72 removed the older flat category table and `category_id`.
- `.cursor/plans/deploy_taxonomy_hierarchy.md` records the production cutover.
- `.cursor/plans/multiple-editors.md` documents the open-note ring and draft
  persistence behavior that this work must preserve.

## 1. Product decision

Epic, Category, and Group are independent, reusable vocabularies owned by a
user. They are not parent-owned nodes.

Examples:

```text
Values owned by one user
  Epic:     all, work, personal
  Category: uncategorized, planning, ideas
  Group:    ungrouped, active, archive

Valid note selections
  work     + planning + active
  personal + planning + active
  work     + ideas    + active
```

The same `planning` category id and `active` group id are reused in every row
above. No category is copied beneath an epic, and no group is copied beneath a
category.

The hierarchy remains a presentation and navigation concept:

```text
Epic selection on notes
  -> Category selection on those notes
       -> Group selection on those notes
            -> Notes
```

It is derived from assignments on notes, not stored as edges between taxonomy
values.

### Locked behavior

- A note has exactly one epic, one category, and one group.
- All combinations of the user's values are valid. Do not add an
  epic-category, category-group, or materialized path table.
- Changing the epic changes only the note's epic.
- Changing the category changes only the note's category.
- Changing the group changes only the note's group.
- Creating a value makes it available from every note picker at that level.
- Creation selects only the newly created level and preserves the other two
  selections.
- Seed exactly one `all` epic, one `uncategorized` category, and one
  `ungrouped` group per user.
- Tags remain many-to-many and orthogonal to all three taxonomy values.
- Tier display words (`Epic`, `Category`, `Group`, `Note`) remain in
  `user_taxonomy_level_v1` and code continues to branch only on numeric level.
- Do not generate the Cartesian product of all values in the sidebar. A value
  combination appears in navigation when at least one note uses it. Empty
  values remain available in pickers and a future taxonomy-management view.

## 2. Final data model

Use one table for the three vocabularies. Three physical tables would repeat
the same label, embedding, timestamp, ownership, merge, and CRUD code without
adding a product invariant.

### `user_taxonomy_value_v1`

Canonical columns:

| Column            | Purpose                                                      |
| ----------------- | ------------------------------------------------------------ |
| `id`              | Identity primary key.                                        |
| `user_id`         | Owner; cascades when the user is deleted.                    |
| `level`           | 1 epic, 2 category, 3 group.                                 |
| `label`           | Normalized lowercase value, consistent with the current app. |
| `is_default`      | Stable identity for the one default value at this level.     |
| embedding columns | Preserve current label autocomplete behavior.                |
| timestamps        | Use `apply_row_timestamps_v1()`.                             |

Required constraints and indexes:

- `CHECK (level BETWEEN 1 AND 3)`.
- `CHECK (label = lower(btrim(label)))`.
- `UNIQUE (user_id, level, label)` — global within the user's level, with no
  parent in the key.
- Partial `UNIQUE (user_id, level) WHERE is_default`.
- `UNIQUE (id, level, user_id)` as the composite FK target.
- FK `(user_id, level)` to `user_taxonomy_level_v1`.
- `(user_id, level)` lookup index.
- Retain one partial HNSW embedding index per level unless measurements show a
  single mixed index is faster.

There is no `parent_id`, `parent_level`, parent FK, root-parent check, sibling
unique constraint, or parent index in the final schema.

### `user_note_v1`

Final taxonomy columns:

| Selection | Columns                             | Constraint                                                |
| --------- | ----------------------------------- | --------------------------------------------------------- |
| Epic      | `epic_id`, `epic_level = 1`         | Composite FK to a level-1 value owned by the note's user. |
| Category  | `category_id`, `category_level = 2` | Composite FK to a level-2 value owned by the note's user. |
| Group     | `group_id`, `group_level = 3`       | Composite FK to a level-3 value owned by the note's user. |

All three ids and fixed-level columns are `NOT NULL` in the final schema. Add
indexes that support FK enforcement and the main per-user grouping/filtering
queries. Preserve production-only workflow columns and migrations; this work
must not recreate or alter them.

### Why no path table

A path table would recreate combinations as records. It could keep one FK on a
note, but changing one picker would still require resolving or creating a path
row, deletion would regain cascading semantics, and the number of stored
combinations would grow for no product benefit. Three note columns directly
express the invariant and make independent edits atomic in one note update.

## 3. Production-safe schema expansion

Do not mutate `user_taxonomy_v1` in place during the first release. The live
server currently queries `parent_id` and writes a required legacy `group_id`.
Create the independent model beside it so applying the expansion migration
before deploying code is safe.

Suggested first migration name:

`<timestamp>__independent_taxonomy_values_expand.sql`

### Expansion migration steps

1. Create `user_taxonomy_value_v1` with the final constraints, embedding
   columns, indexes, and timestamp trigger.
2. Insert one canonical value for every distinct current
   `(user_id, level, label)`. Use deterministic conflict-safe inserts.
3. Add nullable transitional columns to `user_note_v1`:
   `epic_value_id`, `category_value_id`, and `group_value_id`, plus fixed-level
   columns as needed for declarative composite FKs.
4. Backfill every note before changing or deleting any tree row:
   - current `group_id` identifies the legacy group;
   - legacy group `parent_id` identifies the category;
   - legacy category `parent_id` identifies the epic;
   - map each old row to its canonical value by user, level, and label.
5. Create a durable compatibility table such as
   `user_taxonomy_legacy_group_map_v1` containing:
   `user_id`, `legacy_group_id`, `epic_value_id`, `category_value_id`, and
   `group_value_id`. Do not FK `legacy_group_id` to the tree because the tree
   will later be dropped. This table supports old browser drafts and legacy
   clients after cleanup.
6. Abort the migration if any note or legacy group lacks a complete mapping.
   Never fill a missing selection silently with defaults during migration.
7. Add composite FKs from the transitional note columns to
   `user_taxonomy_value_v1`, validate them, then make the three ids `NOT NULL`.
8. Make the legacy `user_note_v1.group_id` nullable during expansion. The old
   deployed code still writes it, while the later canonical-only build can omit
   it before the column is dropped.
9. Seed missing defaults independently at each level for every user. Do not
   use the current "any taxonomy row exists" shortcut.
10. Update `lib/db-notes/scripts/verify-contract.mjs` in the same change.
11. Run the normal sync flow so `schema/current.sql`, generated DB types, and
    the generated Notes app contract are committed with the migration.

### Backfill assertions

The migration or its verification must prove:

- every note has all three canonical ids;
- all three values belong to the note's user and have the required level;
- there is exactly one canonical row per `(user, level, label)`;
- every legacy level-3 id has a compatibility mapping;
- the count of notes is unchanged;
- note descriptions, dates, tags, embeddings, and timestamps are unchanged;
- duplicate `ungrouped`, `uncategorized`, and other labels collapse to one
  canonical id per level without changing any note's original three labels.

## 4. Transitional backend and compatibility contract

The first code release after the expansion migration should use canonical
values while keeping enough legacy behavior for rollback.

### Canonical app contract

Update `lib/db-notes/contracts/notes-app.ts` and generated JSON:

```ts
interface TaxonomyRecord {
  id: number
  userId: number
  level: number
  label: string
  isDefault: boolean
  noteCount: number
  lastUsedAt: string | null
}

interface NoteRecord {
  epicId: number
  categoryId: number
  groupId: number
  // existing note fields
}

interface NoteInput {
  epicId: number
  categoryId: number
  groupId: number
  // existing input fields
}

interface LegacyTaxonomySelection {
  legacyGroupId: number
  epicId: number
  categoryId: number
  groupId: number
}
```

- Remove `parentId` and tree-specific `directNoteCount` from the final
  `TaxonomyRecord`.
- Treat `noteCount` as usage of that value at its own level, independent of the
  other two values.
- Introduce a temporary explicit contract-version signal, for example
  `X-Notes-Taxonomy-Version: 2`, on upgraded web and Android requests.
- Versioned requests receive the canonical value list and notes with all three
  ids. Unversioned requests continue receiving the legacy tree and legacy
  `groupId` until compatibility is retired.
- Include the authenticated user's `legacyTaxonomySelections` in the versioned
  bootstrap response during the support window. This keeps startup as one
  request and lets the v2→v3 web draft upgrader resolve never-saved drafts.
- Do not try to infer the contract from numeric ids or from whether a payload
  happens to contain `epicId`. Old clients persist server responses and can
  send them back later, and old/new identity sequences may overlap.
- A group-only legacy PATCH preserves the note's canonical epic/category while
  translating its legacy group through `user_taxonomy_legacy_group_map_v1`.
  A group-only legacy POST uses that mapping's original triple. This is enough
  for the old flat Android UI without pretending it can edit independent
  epic/category fields.
- Keep the version branch at the route/service boundary so canonical SQL and
  legacy compatibility do not become interleaved throughout the application.

### Taxonomy SQL and services

Rewrite `lib/db-notes/sql/taxonomy.ts` around values:

- list/order values by level and label;
- resolve/create by `(user_id, level, label)` using the existing
  `ON CONFLICT ... DO UPDATE ... RETURNING id` concurrency pattern;
- ensure each default value independently;
- suggest by user + level only; remove parent filtering;
- count notes by `epic_id`, `category_id`, or `group_id` according to level;
- rename globally within a level;
- remove move/reparent operations;
- retain embedding create/backfill/stale-update behavior.

Update note create, update, select, search-result mapping, and bootstrap paths
to read and write all three ids.

### Temporary dual write

Until rollback and Android compatibility are closed, a canonical note save
also resolves a hidden legacy tree path by the selected labels and writes its
legacy group id. These duplicated legacy nodes are compatibility data only and
are returned only to unversioned legacy clients, never as the canonical
taxonomy vocabulary.

This provides two properties:

- rolling the server back still finds a valid legacy `group_id` for every note;
- an older client can continue saving while the replacement client is being
  released.

Keep the dual-write helper isolated and visibly temporary. It is removed before
the legacy tree cleanup migration.

Dual write covers taxonomy CRUD as well as note saves:

- canonical create ensures an appropriate legacy representative/path exists;
- canonical rename updates every mapped legacy copy at that level;
- canonical delete/replacement rebuilds affected legacy paths and rewrites
  legacy note group ids without changing canonical selections;
- a legacy taxonomy mutation resolves or updates its canonical value and map;
- compatibility tests compare labels and note placement in both
  representations after every operation.

If a mutation cannot be represented safely in both models, reject that
mutation during the compatibility window instead of weakening the canonical
model or silently diverging rollback data.

### Delete semantics

Tree deletion modes become invalid because values have no children.

Final request shape:

```ts
{
  taxonomyId: number
  replacementId?: number
  deleteNotes?: boolean
}
```

Rules:

- unused value: delete directly, subject to keeping at least one value at the
  level;
- reject deletion of the current `is_default` row until a separate operation
  explicitly promotes a same-level replacement;
- used value + replacement: validate same user and same level, update only the
  matching note column, then delete the value in one transaction;
- used value + `deleteNotes: true`: delete only notes directly using that
  value, never other taxonomy values;
- used value with neither explicit choice: reject;
- replacement preserves the notes' other two selections;
- no operation deletes or moves categories/groups as a side effect of deleting
  an epic/category.

If product does not need destructive note deletion here, omit `deleteNotes`
entirely and require replacement. Prefer that smaller, safer contract.

### Anonymous-account merge

Rewrite taxonomy merge to deduplicate canonical values by `(level, label)` with
no top-down parent ordering. Build remaps for all three levels, then update a
note's `epic_value_id`, `category_value_id`, `group_value_id`, and `user_id` in
one constraint-safe operation.

- Continue returning taxonomy id remaps to the web client.
- Apply remaps to all three ids in ring entries and detached saves.
- Keep legacy-tree merging only while dual write is active.
- Extend `MERGE_TABLE_STRATEGIES` for every new user-owned table and keep the
  verification that fails on an unregistered FK table.
- Treat canonical values as `dedup-remap`. Rebuild/reparent the anonymous
  user's legacy group mappings with the canonical id remaps so a v2 snapshot
  keyed to the anonymous session can still upgrade after sign-in.
- Preserve the destination account's tier vocabulary, current preferences
  merge, tags, and best-effort embedding backfill behavior.

### API surface

Final taxonomy API:

| Method/path                      | Final behavior                                                                                                     |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `GET /api/taxonomy`              | Flat independent values plus tier vocabulary for versioned clients; temporary legacy tree for unversioned clients. |
| `POST /api/taxonomy`             | Create/resolve `{ level, label }`; no parent.                                                                      |
| `PATCH /api/taxonomy`            | Rename only.                                                                                                       |
| `DELETE /api/taxonomy`           | Delete/reassign notes at that level explicitly.                                                                    |
| `GET/PATCH /api/taxonomy/levels` | Unchanged tier-word behavior.                                                                                      |
| `POST /api/taxonomy/suggest`     | User + level scoped; no parent.                                                                                    |
| `POST /api/taxonomy/path`        | Compatibility only, then remove.                                                                                   |

Do not add an independent-values endpoint beside a permanent tree endpoint.
The public meaning of taxonomy should converge on one model. The temporary
version branch is removed when Android/rollback compatibility closes.

## 5. Web client cutover

### Draft and save model

Replace the leaf-only form field with all three persisted selections:

```ts
interface NoteFormState {
  selectedEpicId: number | null
  selectedCategoryId: number | null
  selectedGroupId: number | null
  // existing fields
}
```

- `serializeNoteDraft`, `snapshotNoteForm`, `noteRequestBody`,
  `noteToFormState`, dirty checks, detached saves, exit keepalive, and merge
  remaps include all three ids.
- `isSaveableForm` requires non-empty content and all three ids.
- `isBlockedForm` identifies which selections are missing and the UI continues
  to show `blocked` rather than fake `unsaved`.
- Programmatic reconciliation must recompute `savedSignature` for clean
  entries. User picker changes remain dirty and autosave normally.
- Async create handlers continue capturing `targetKey` before `await`.

### Picker behavior

- Epic options are all level-1 values.
- Category options are all level-2 values, regardless of epic.
- Group options are all level-3 values, regardless of category or epic.
- Selecting one option patches only its matching form field.
- Creating one value posts `{ level, label }`, selects that returned id, and
  leaves the other ids untouched.
- Remove `resolveGroupUnderEpic`, `resolveGroupUnderCategory`, automatic child
  creation, and default-child fallback behavior.
- A new draft receives all three seeded defaults, unless it is created from a
  navigation context that supplies an explicit selection tuple.

### Index and navigation

Replace `childrenOf`, `pathByGroupId`, and parent walking with:

- `byId`;
- stable arrays/maps by level;
- a helper that resolves a path from a note or draft's three ids;
- level labels.

Rewrite `buildEpicNoteGroups` to bucket notes by their persisted ids:

1. epic id;
2. category id inside the note's epic bucket;
3. group id or group badge, according to the retained sidebar design;
4. notes.

Do not pre-create every category beneath every epic. A new value with zero
notes exists in the picker but produces no empty branch in every navigation
bucket.

The sidebar's navigation-only epic selection remains separate from the active
note unless the user edits the note's epic picker.

### URL, server cache, and open-draft upgrades

- Add `?epic=`, `?category=`, and `?group=` for a complete active draft
  selection. Keep `?id=` and `?tags=` behavior.
- A legacy URL containing only the old group id uses the compatibility map or
  opens the saved note; it must not infer category/epic from the new global
  group.
- Bump the replaceable `notes-app-cache` schema/key because taxonomy records
  and notes change shape.
- Bump `OPEN_NOTES_SCHEMA_VERSION` from 2 to 3 with an explicit upgrade.
- The v2→v3 upgrader collects legacy `selectedGroupId` values and resolves each
  through the server-provided compatibility map. It must work for never-saved
  dirty drafts, not only notes that can be reloaded from PostgreSQL.
- Recompute signatures for entries that were clean under v2. Preserve the old
  nonmatching signature for entries that were dirty.
- Keep `user_taxonomy_legacy_group_map_v1` for as long as v2 browser snapshots
  are supported. Open-note snapshots currently have no expiry, so dropping the
  map requires an explicit product decision and a communicated cutoff.
- Test cached-paint followed by fresh reconciliation. Neither pass may replace
  unsaved text or selections with defaults.

### Taxonomy editing UI

- Remove move/reparent controls and copy.
- Rename/delete modals stay level-aware via the user's tier words.
- Delete confirmation lists the number of directly affected notes and offers
  valid same-level replacements.
- A separate value-management surface may list empty values; do not make the
  sidebar render fake empty combinations merely to expose editing controls.

## 6. Android cutover

Android is experimental, but `notes-next` is its production API. Keep the
compatibility path until a replacement APK is built and linked in the PR.

Read the closest Android `AGENTS.md` files before editing. Expected surfaces:

- `model/Models.kt`: note, draft, and taxonomy record shapes;
- `data/JsonCodec.kt`: all three ids and parentless values;
- `data/NotesApiClient.kt`: create/update requests and taxonomy CRUD;
- `data/NotesRepository.kt`: defaults, reconciliation, and save validation;
- `data/SessionStore.kt`: cached data version/upgrade or safe invalidation;
- `ui/MainActivity.kt`, category/group popups, overlay activities, and widgets:
  selection/filter logic that currently treats level-3 groups as categories;
- `tools/validate-notes-contract.mjs` and API adapter tests.

Minimum required behavior before removing server compatibility:

- Android decodes `epicId`, `categoryId`, and `groupId`;
- upgraded Android requests send the taxonomy contract-version signal;
- creates and updates send all three;
- cached legacy group ids are translated or invalidated without losing note
  text;
- filters and widgets do not assume `groupId` encodes the full path;
- APK generation succeeds for both explicit dev and prod targets.

The full three-picker Android UX may follow the stable web UI, but the contract
and persistence model cannot remain leaf-only once compatibility is removed.

## 7. Cleanup release

Cleanup is deliberately separate and runs only after the canonical model is
the sole writer.

### Gate before cleanup

- Railway is running code that reads canonical values and does not query
  `user_taxonomy_v1.parent_id`.
- Web writes all three ids and v2 draft upgrade has been exercised.
- Anonymous merge remaps all three ids.
- The replacement Android APK is available, or product explicitly accepts
  ending old-APK write compatibility.
- Production queries show no note missing a canonical id.
- Dual-write comparison shows every legacy group path has the same three labels
  as the canonical selection.
- A backup and the exact rollback boundary are recorded.

### Final code deploy before destructive migration

First deploy code that no longer reads or writes the legacy tree/group column.
The expansion migration must already have made the legacy column optional, so
this code still runs while the old structures exist.

### Cleanup migration

Suggested name:

`<later-timestamp>__drop_legacy_taxonomy_tree.sql`

Steps:

1. Drop the legacy `user_note_v1.group_id` FK/index/column after renaming the
   canonical transitional columns into final `epic_id`, `category_id`, and
   `group_id` names as needed.
2. Drop legacy parent/tree constraints, indexes, triggers, and
   `user_taxonomy_v1` itself.
3. Remove obsolete generated schema/type artifacts and replace old assertions
   with explicit absence assertions in `verify-contract.mjs`.
4. Retain `user_taxonomy_legacy_group_map_v1` unless the support-horizon gate
   has separately been approved. It no longer needs the old tree to resolve
   v2 drafts.
5. Do not touch the production-only Gemini/workflow migration records or
   workflow columns/tables.

After this migration, rollback to tree-based application code is not possible
without restoring a backup. Treat it as the irreversible boundary.

## 8. File map

### Database and shared service

- `lib/db-notes/migrations/*independent_taxonomy_values*.sql`
- `lib/db-notes/migrations/*drop_legacy_taxonomy_tree*.sql`
- `lib/db-notes/schema/current.sql`
- `lib/db-notes/generated/contracts/db-schema.json`
- `lib/db-notes/generated/typescript/db-types.ts`
- `lib/db-notes/contracts/notes-app.ts`
- `lib/db-notes/generated/contracts/notes-app.json`
- `lib/db-notes/scripts/verify-contract.mjs`
- `lib/db-notes/sql/taxonomy.ts`
- `lib/db-notes/sql/taxonomy-level.ts`
- `lib/db-notes/sql/note/*`
- `lib/db-notes/sql/user/anonymous.ts`
- `lib/db-notes/services/notes-app.ts`
- `lib/db-notes/testing/default-taxonomy.test.ts`
- `lib/db-notes/testing/anonymous-merge.test.ts`
- `lib/db-notes/testing/note-embedding-skip.test.ts`
- `lib/db-notes/testing/notes-api-adapter-suite.ts`

### Web API and UI

- `apps/notes-next/app/api/_lib/notes-app-route-handlers.ts`
- `apps/notes-next/app/api/taxonomy/**`
- `apps/notes-next/src/types/notes.ts`
- `apps/notes-next/src/lib/noteDraft.ts`
- `apps/notes-next/src/lib/openNotesStorage.ts`
- `apps/notes-next/src/lib/notesCache.ts`
- `apps/notes-next/src/lib/taxonomyIndex.ts`
- `apps/notes-next/src/lib/taxonomySelection.ts` (remove or redefine)
- `apps/notes-next/src/lib/sidebarTaxonomy.ts`
- `apps/notes-next/src/stores/openNotes.ts`
- `apps/notes-next/src/stores/notesAppStore.ts`
- `apps/notes-next/src/components/notes/NotesApp.tsx`
- `apps/notes-next/src/components/notes/NoteForm.tsx`
- `apps/notes-next/src/components/notes/ResultsColumn.tsx`
- `apps/notes-next/src/components/notes/NotesHeader.tsx`
- taxonomy edit/delete modals and affected tests under `apps/notes-next/test/`

### Documentation

Update `lib/db-notes/AGENTS.md`, `apps/notes-next/AGENTS.md`, relevant Android
`AGENTS.md` files, and the frontend handoff status once the architecture ships.
Remove obsolete strict-tree and leaf-only invariants rather than leaving both
models documented.

## 9. Automated tests

### Database migration and constraints

Create fixtures with:

- `planning` beneath two epics;
- `ungrouped` beneath several categories;
- the same non-default group label beneath different categories;
- notes in every path;
- a user with only partial/missing default rows;
- an anonymous and permanent account with overlapping values.

Assert:

- duplicates collapse to one canonical value per level;
- each note retains its exact old epic/category/group labels;
- wrong-level and cross-user note references are rejected by PostgreSQL;
- one default value is repaired independently at each missing level;
- default identity survives a label rename and a default cannot be deleted
  without an explicit future product flow for replacing it;
- concurrent creates resolve the same id;
- deleting with a replacement changes only one note column;
- independent usage counts and last-used timestamps are correct;
- anonymous merge deduplicates/remaps all three levels and preserves tags,
  preferences, note text, and embeddings behavior;
- legacy group maps survive cleanup and resolve v2 draft selections.

### Shared API adapters

Extend the shared suite used by web and Android:

- note payloads require/return all three ids;
- create taxonomy ignores/rejects parent input according to the compatibility
  stage;
- suggest is level-only;
- update cannot reparent;
- delete validates same-level replacement and explicit disposition;
- legacy group-only requests translate only through the compatibility map;
- versioned requests receive canonical records and unversioned requests receive
  legacy records throughout the compatibility window;
- authenticated user ownership continues overriding client `userId`.

### Web pure tests

- Selecting epic preserves category and group.
- Selecting category preserves epic and group.
- Selecting group preserves epic and category.
- Creating a value changes only its level.
- Sidebar bucketing displays only combinations used by notes and never creates
  a Cartesian product.
- The same category/group records can appear under multiple displayed branches.
- v2→v3 clean draft recomputes its signature and does not autosave.
- v2→v3 dirty/never-saved draft keeps its text and exact mapped selection.
- missing or deleted values remap only the affected level and preserve dirty
  state correctly.
- merge remaps all three selections in ring and detached entries.
- group-only legacy URLs upgrade; canonical URLs round-trip all three ids.
- exit/keepalive payloads include the full selection.

### Android

- Contract validator matches the generated Notes app contract.
- JSON round-trips all three ids.
- repository saves and reloads independent selections.
- cached legacy state follows the chosen upgrade/invalidation behavior.
- group/category filters use the intended independent field.

## 10. Verification commands

Run from the repository root with `pnpm` only.

Against the local throwaway Notes databases:

```bash
pnpm run db:migrate
pnpm run db:verify
pnpm --filter @lib/db-notes test
pnpm --filter notes-next test
pnpm run verify:notes-web
pnpm run verify:android
pnpm run release:notes:prepare
```

When Android code changes, also build the explicit targets required by the
release model:

```bash
pnpm run build:android:dist:dev
pnpm run build:android:dist:prod
```

Manual browser verification:

1. Create one value at each level and confirm it appears in every corresponding
   picker without duplicate records.
2. Change epic and confirm category/group ids and labels remain identical.
3. Change category and confirm epic/group remain identical.
4. Use one category/group combination under multiple epics and verify the
   sidebar branches and counts.
5. Delete each level with a replacement and confirm only that field changes on
   affected notes.
6. Exercise an open dirty note, detached dirty save, anonymous claim, and
   anonymous-to-existing-account merge.
7. Seed a v2 localStorage draft containing unsaved text, upgrade, and verify the
   exact triple plus text survives.
8. Clear the replaceable server cache/localStorage after saves and reload.
   Verify notes from PostgreSQL or the network response, not only the screen.
9. Confirm semantic note search is unchanged and taxonomy autocomplete remains
   level scoped.

## 11. Production rollout and rollback

### Before the expansion migration

- Record counts of users, notes, tree rows per level, duplicate labels per
  `(user, level)`, incomplete paths, and orphans.
- Export/read-only capture every current note id with its epic/category/group
  ids and labels for post-migration comparison.
- Confirm a recent database backup and restore procedure.
- Confirm Railway is on the expected commit and `/api/health` is healthy.
- Never run `db:verify` against production; it is not read-only.

### Release A — expand

1. Merge the additive migration, verification, canonical services behind
   compatibility, and tests.
2. Apply only the expansion migration to production.
3. Deploy the transitional backend/web build.
4. Confirm new and legacy representations agree and no note lacks canonical
   ids.
5. Monitor note create/update, taxonomy create/delete, bootstrap, anonymous
   merge, and database constraint errors.

Rollback: deploy the previous app. The legacy tree and legacy note group id are
still present and were dual-written. The shadow canonical table can remain
unused until a forward fix; do not destructively remove it during an incident.

### Release B — clients

1. Ship and verify the v3 web draft/cache upgrade.
2. Build and publish the replacement Android APK link.
3. Keep compatibility and dual write active while adoption/verification is in
   progress.
4. Record the decision about how long v2 browser snapshots and older APKs are
   supported.

### Release C — stop legacy writes

1. Deploy code that no longer reads/writes the tree or legacy note group id.
2. Verify it while old structures still exist.
3. Re-run canonical-vs-legacy read-only comparisons.

Rollback is still possible to the transitional build at this point, but not to
the original leaf-only build for notes created after legacy writes stopped.

### Release D — destructive cleanup

1. Apply the cleanup migration only after every cleanup gate passes.
2. Run read-only invariant and count queries.
3. Confirm `/api/health`, authenticated bootstrap, note saves, taxonomy edits,
   anonymous merge, and `jot.new` behavior.
4. Leave production-only migrations and workflow structures untouched.

After cleanup, rollback is restore-or-forward-fix only. Record that boundary in
the deploy plan and PR before applying it.

## 12. PR and handoff requirements

Prefer reviewable releases rather than one permanent branch containing both
the reversible expansion and irreversible cleanup:

1. Expansion schema + transitional backend + migration tests.
2. Web independent-selection cutover + v3 draft/cache upgrade.
3. Android contract/client cutover.
4. Stop-dual-write code and destructive cleanup migration.

Every PR description must include:

- the architecture decision and why parent-owned nodes were removed;
- every added/modified file and its role;
- the exact current rollout phase and what remains compatible;
- migration/backfill assertions and test results;
- browser draft and Android compatibility behavior;
- production commands actually run and their results;
- rollback boundary and cleanup gates;
- deployment/handoff notes sufficient for the next agent or engineer without
  this conversation.

## 13. Definition of done

This architecture is complete when:

- one user cannot have duplicate values with the same normalized label at the
  same level;
- every user has exactly one stable default value at each taxonomy level;
- every note stores valid owned epic/category/group ids independently;
- changing one editor picker leaves the other two unchanged in PostgreSQL, not
  only in local state;
- the same category and group ids are reusable under any displayed epic and
  category combination;
- navigation is derived from note assignments and does not materialize every
  possible combination;
- create, rename, suggest, counts, delete/replacement, defaults, embeddings,
  search, anonymous merge, caches, URLs, and detached saves use the independent
  model;
- v2 browser drafts retain unsaved text and exact old placement;
- the web and supported Android client send all three ids;
- DB verification, service tests, web tests/build, and Android verification
  pass;
- production has passed the read-only before/after path comparison;
- obsolete tree code, constraints, endpoints, tests, and documentation are
  removed after the rollback window closes;
- the final PR and deployment record contain the recovery boundary and all
  remaining support-horizon decisions.
