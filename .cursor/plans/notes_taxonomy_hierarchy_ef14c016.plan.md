---
name: Notes Taxonomy — Epic > Category > Group > Note hierarchy
overview: Documents how notes are persisted today (flat single-category taxonomy plus many-to-many tags, saved asynchronously from a bounded ring of simultaneously open notes) and plans the extension to a four-level strict hierarchy — Epic > Category > Group > Note — where every child has exactly one parent, tags stay many-to-many on notes, every taxonomy level carries a label embedding for autocomplete, and semantic note search is simplified to compare the query against the note description embedding only. The tier names themselves are per-user editable data, including the word Note, which is what lets the same app manage tasks or any other content. The program branches only on the level number while a separate user_taxonomy_level_v1 table holds each user's words for levels 1-4. The hierarchy lives in one self-referencing user_taxonomy_v1 table whose depth, parent level, per-user ownership, and tier-definition existence are all enforced declaratively by composite foreign keys with no triggers. Rebased onto the merged multi-note editor (PR #69), Part 6 works through how the hierarchy fits the open-note ring — the note draft holds exactly one taxonomy id and it is the leaf group, which keeps the dirty-check signature honest and makes a taxonomy move cost zero note writes, and the localStorage snapshot must be upgraded rather than version-bumped or every unsaved draft is silently discarded. Section 6.6 records five gaps found reviewing the ring against the hierarchy, two of which are live data-loss bugs in shipped code (a sidebar move sends last-saved text over the live draft, and an anonymous merge relocates a dirty open note), plus a reproduced label-upsert race and a roll-up query shape that is 5x cheaper. The DDL, the backfill, the tier-rename layer, the search rewrite, and the concurrency edge cases were prototyped and validated against a real PostgreSQL 17 + pgvector 0.8.6 cluster before this plan was written.
todos:
  - id: schema_migration_phase1
    content: "Phase 1 (additive) migration: create user_taxonomy_level_v1 (per-user tier names for levels 1-4) and user_taxonomy_v1 (hierarchy, composite-FK level/ownership/tier-existence enforcement, partial HNSW label indexes); seed the Epic/Category/Group/Note vocabulary for every user FIRST; backfill an epic + a level-2 row per existing category + a group per category, all auto-created items labelled 'uncategorized'; add user_note_v1.group_id (+ pinned group_level) and backfill from category_id. Leaves user_note_category_v1 and user_note_v1.category_id in place."
    status: pending
  - id: verify_contract_phase1
    content: Extend scripts/verify-contract.mjs with must-exist assertions for both new tables, their columns, constraints, indexes and triggers, plus the structural invariants (every user has all four tier definitions, no duplicate tier names, no level skew, no cross-user parenting, every user has an epic/category/group chain, every note resolves to a level-3 row)
    status: pending
  - id: merge_registry
    content: Register BOTH user_taxonomy_v1 (dedup-remap) and user_taxonomy_level_v1 (drop) in MERGE_TABLE_STRATEGIES, and rewrite mergeAnonymousUserInto to remap a three-level subtree in level order instead of a flat category list (db:verify fails until this is done)
    status: pending
  - id: contract_types
    content: "Replace CategoryRecord with TaxonomyRecord (id, userId, level, parentId, label, noteCount, directNoteCount, lastUsedAt) in contracts/notes-app.ts; add TaxonomyLevelRecord plus level constants and default labels, delivered on the session payload; change NoteInput.categoryId to groupId; add NoteRecord.group/category/epic refs; simplify SemanticSearchResult to { note, similarity }"
    status: pending
  - id: sql_service_layer
    content: Collapse sql/category.ts into sql/taxonomy.ts (level-parameterized CRUD, subtree note counts, per-level fallback resolution, move/reparent, delete-with-children and delete-with-notes), carry ensureDefaultCategoryForUser forward as ensureDefaultTaxonomyChainForUser on the GET /api/taxonomy path, add sql/taxonomy-level.ts with ensureTaxonomyLevelsForUser wired into user creation, and update sql/note/* to read and write group_id while leaving PR #69's embedding-skip and expectedDescription guard intact
    status: pending
  - id: tier_rename_ui
    content: Make the four tier words data end to end — GET/PATCH /api/taxonomy/levels, a store selector for the vocabulary, a rename UI, and removal of the ~2 dozen hardcoded 'Categories'/'Notes' strings across 8 notes-next files. Never branch on a label; ids and level numbers only in URLs, cache keys and filters.
    status: pending
  - id: search_simplify
    content: Rewrite searchNotesByEmbedding as an exact per-user description-only scan (drop the 0.67/0.33 composite, the category join and the tag AVG subquery); do NOT switch to an index-ordered HNSW scan — it silently returns 0 rows for users holding a small share of the table
    status: pending
  - id: autocomplete_endpoint
    content: Add level-scoped label autocomplete (literal prefix match first, embedding similarity as semantic fallback) backed by label_embedding, and extend embed-on-write plus embedding maintenance to all three taxonomy levels
    status: pending
  - id: api_routes
    content: Replace /api/categories with /api/taxonomy (level-aware CRUD + move), add /api/taxonomy/suggest and /api/taxonomy/levels, update /api/notes payloads, update /api/embeddings/debug and /embeddings to drop composite scoring
    status: pending
  - id: open_notes_draft_layer
    content: "Land the open-note draft layer on its own, before any UI work, because a mistake here silently destroys unsaved drafts. NoteFormState.selectedCategoryId becomes selectedGroupId and nothing else (epic/category are derived from the tree, never stored, never in the signature); serializeNoteDraft/noteRequestBody/isSaveableForm move to groupId; openNotesStorage UPGRADES v1 snapshots to v2 by mapping each old categoryId to that category's seeded group and recomputing savedSignature — do NOT just bump schemaVersion, isSnapshot rejects unknown versions and the caller reads null as 'nothing to restore'."
    status: pending
  - id: taxonomy_remap_and_blocked_state
    content: "Make taxonomy edits safe against N concurrent background writers: rename remapEntriesAfterCategoryChange to remapEntriesAfterTaxonomyChange, handle a group dying because an ancestor was deleted, remap detachedSavesRef as well as the ring (a gap that exists today), always remap before issuing the delete, and add a 'blocked' NoteSaveStatus so an unsaveable entry stops failing silently"
    status: pending
  - id: fix_sidebar_move_clobber
    content: "Fix live data loss found reviewing the ring (6.6a): patchNoteFromSidebar sends the last-saved description rather than the live draft, and applyServerNoteToEntry then overwrites the entry's form and marks it clean, so moving an open note within the 3s autosave window silently discards the user's typing. When the note is open, make a sidebar move a draft edit on the entry and let autosave carry it; keep the direct PATCH only for notes that are not open."
    status: pending
  - id: merge_returns_taxonomy_remap
    content: "Have the anonymous merge return the id remap it already computes and apply it to ring entries and detachedSavesRef before reconciliation, recomputing savedSignature for entries that were clean (6.6b). Without it, a dirty open note whose pre-merge flush failed is silently relocated to the fallback group, losing its whole path."
    status: pending
  - id: upsert_race_and_rollup_shape
    content: "Two measured server-side fixes (6.6c, 6.6d): change the label-resolve upsert from ON CONFLICT DO NOTHING + UNION ALL SELECT to ON CONFLICT DO UPDATE ... RETURNING id, which returns zero rows under concurrent creation of the same label and makes the service throw (reproduced on PG 17.11) — apply to tags too; and implement listTaxonomyByUser's subtree counts as fixed-depth aggregates rather than a recursive CTE, 5.5 ms vs 26-31 ms at 20k notes, keeping the recursive form in tests as the oracle. Also add the transactional POST /api/taxonomy/path (6.6e)."
    status: pending
  - id: frontend
    content: Rework NotesApp/ResultsColumn/NoteForm/NotesHeader/notesAppStore/notesCache from two flat accordions into a hierarchy tree with a three-step picker (picker navigation state on the entry, not the form) and id-based hierarchical URL state
    status: pending
  - id: android_contract
    content: Update Android Models.kt/JsonCodec.kt/NotesApiClient.kt (adding TaxonomyLevelRecord and persisting the vocabulary in AppSnapshot so the widget can label itself offline) and the widget filters, then run contracts:check and rebuild the APK
    status: pending
  - id: schema_migration_phase2
    content: "Phase 2 (cutover) migration, only after the new code is deployed: drop user_note_v1.category_id, drop user_note_category_v1, and flip verify-contract assertions to must-be-absent"
    status: pending
  - id: regenerate_embeddings
    content: Extend scripts/regenerate-embeddings.mjs to cover all three taxonomy levels (it currently embeds tags and notes but never categories) and run it after the rollout
    status: pending
isProject: true
---

# Notes Taxonomy — Epic > Category > Group > Note

## Status: plan only — no implementation in this branch

Rebased onto `main` after the multi-note editor merged
([PR #69](https://github.com/paulshorey/notes/pull/69)), which put several notes
in a bounded ring saving asynchronously in the background.

This document has two halves. **Part 1** documents the current persistence
architecture as it actually exists, including the new ring (section 1.3a).
**Part 2** onward is the plan to extend it.

The database design is unaffected by the ring: the schema, the migration and the
search rewrite stand as validated. What the ring changes is the client contract
for a note's taxonomy field, and **Part 6** is devoted to it. Read Part 6 before
touching anything under `apps/notes-next`.

Four of its findings are silent-data-loss bugs, all of which fail without an
error and two of which are live in shipped code today:

|      | Finding                                                                       | Status               |
| ---- | ----------------------------------------------------------------------------- | -------------------- |
| 6.1  | Dropping the taxonomy id from the draft signature makes a move never autosave | risk in the new work |
| 6.3  | Bumping the `localStorage` schema version discards every unsaved draft        | risk in the new work |
| 6.6a | A sidebar move sends the last-saved text and overwrites the live draft        | **live today**       |
| 6.6b | An anonymous merge relocates a dirty open note to the fallback group          | **live today**       |

Section 6.4 covers a fifth, the silent-no-save trap, which has already cost this
project a full round of manual testing against an empty table.

Every schema statement, constraint and query plan in Part 2 was prototyped
against a real PostgreSQL 17.11 + pgvector 0.8.6 cluster before this plan was
written, including the data backfill over seeded pre-migration rows. The
verification transcripts are in the appendix.

---

# Part 1 — How notes are saved today

## 1.1 Tables

Six tables in `public`, all owned by `lib/db-notes`. Every table name carries a
`_v1` suffix; every user-owned table has an `ON DELETE CASCADE` foreign key to
`user_v1`.

```
user_v1
  id, username (UNIQUE), email, phone, password, is_anonymous,
  preferences jsonb, time_created, time_modified

user_note_category_v1                       user_note_tag_v1
  id, user_id ──────► user_v1                 id, user_id ──────► user_v1
  label   UNIQUE (user_id, label)             label   UNIQUE (user_id, label)
          CHECK (label = lower(btrim(label))) CHECK (label = lower(btrim(label)))
  category_embedding vector(1024)             tag_embedding vector(1024)
  embedding_model, embedding_updated_at       embedding_model, embedding_updated_at

user_note_v1
  id, user_id ──────► user_v1  (CASCADE)
  category_id NOT NULL ──────► user_note_category_v1  (RESTRICT)
  description text NULL
  time_due, time_remind, time_created, time_modified
  description_embedding vector(1024)
  embedding_model, embedding_updated_at

user_note_tag_link_v1
  note_id ──────► user_note_v1 (CASCADE)
  tag_id  ──────► user_note_tag_v1 (CASCADE)
  PRIMARY KEY (note_id, tag_id)

user_api_token_v1
  id, user_id ──────► user_v1 (CASCADE), token_hash UNIQUE, time_last_used
```

Relationship cardinality today:

| Relationship      | Cardinality      | Enforced by                            |
| ----------------- | ---------------- | -------------------------------------- |
| user → notes      | one-to-many      | `user_note_v1.user_id` FK              |
| user → categories | one-to-many      | `user_note_category_v1.user_id` FK     |
| user → tags       | one-to-many      | `user_note_tag_v1.user_id` FK          |
| category → notes  | one-to-many      | `user_note_v1.category_id` NOT NULL FK |
| note → category   | **exactly one**  | NOT NULL + FK                          |
| note ↔ tags      | **many-to-many** | `user_note_tag_link_v1`                |

There is **no** parent/child relationship anywhere in the taxonomy. Categories
and tags are two independent flat lists per user. Notes are leaves hanging
directly off one category.

Three HNSW cosine indexes exist — one per embedding column
(`user_note_v1_description_embedding_hnsw_idx`,
`user_note_category_v1_category_embedding_hnsw_idx`,
`user_note_tag_v1_tag_embedding_hnsw_idx`). Section 6.2 shows that the note one
is effectively dead weight under the current query shape.

`apply_row_timestamps_v1()` is a shared trigger function attached to `user_v1`,
`user_note_v1`, `user_note_category_v1` and `user_note_tag_v1`. It pins
`time_created` on update and refreshes `time_modified` on every write.

## 1.2 Layering

```
apps/notes-next  (Next.js: UI + REST API)          apps/notes-android (Kotlin)
        │  app/api/**/route.ts                              │ NotesApiClient.kt
        │  wired through                                     │ HTTP + Bearer token
        │  app/api/_lib/notes-app-route-handlers.ts          │
        └──────────────────┬─────────────────────────────────┘
                           ▼
        lib/db-notes/services/notes-app.ts   ← request parsing, orchestration,
                           │                   embed-on-write, error → HTTP status
                           ├── services/notes-embeddings.ts  → Jina AI
                           └── sql/{note,category,tag,user}  → raw SQL via pg Pool
                                        │
                                        ▼
                              PostgreSQL (DB_NOTES_URL)
```

`apps/notes-next` contains **no SQL and no Jina calls**, with one deliberate
exception: the standalone debug route `app/api/embeddings/debug/route.ts`, which
calls Jina directly and never touches the database.

## 1.3 The save path, end to end

Since PR #69 the client keeps **several notes open at once** in a bounded
most-recently-used ring and saves them in the background, so this path is now
asynchronous and per-entry. Section 1.3a describes the ring; this section
follows one save from the client to the row.

Creating or updating a note (`POST` / `PATCH /api/notes`):

1. **Client** — `saveEntry(key, mode)` in `NotesApp.tsx` snapshots the entry's
   form and builds the payload with `noteRequestBody` (`src/lib/noteDraft.ts`):

   ```ts
   {
     categoryId: form.selectedCategoryId,
     tagIds: form.selectedTagIds,
     description: form.description,
     timeDue: form.dueExpanded ? form.timeDue : null,
     timeRemind: form.remindExpanded ? form.timeRemind : null,
   }
   ```

   The form is snapshotted **before** any `await`, so later keystrokes belong to
   the next save rather than this one.

2. **Auth** — the route derives the acting user from the NextAuth session cookie
   or an `Authorization: Bearer` token. Any client-supplied `userId` is
   overwritten server-side in `readAuthorizedJsonObject`.

3. **Parse** — `parseCreateNoteRequest` → `parseNoteInput` (`sql/note/parse.ts`)
   coerces `categoryId` to a positive integer, de-duplicates `tagIds`, and
   normalizes `timeDue` / `timeRemind` to ISO strings or `null`.

4. **Embed before write, unless the text is unchanged** — `createNoteForNotesApp`
   calls `createNoteEmbeddingInput`, which sends the trimmed description to Jina
   with `task: "retrieval.passage"` and returns a `vector(1024)` literal plus the
   model tag `jina-embeddings-v5-text-small:notes-v3`. An empty description
   yields `{ descriptionEmbedding: null, embeddingModel: null }`. **A Jina
   outage fails the note save** — the embedding call is not deferred or
   best-effort.

   On update there is now a fast path. `canReuseStoredEmbedding`
   (`services/notes-app.ts`) reads the stored description and embedding state
   with `selectNoteEmbeddingStateById` and skips Jina entirely when the
   normalized description is unchanged and the stored vector is present and
   current-model. `updateNoteForUser` then omits the embedding columns from the
   `UPDATE` and adds `AND description IS NOT DISTINCT FROM $n` as a race guard;
   if that guard fails, the service falls back to a full re-embed. This matters
   for the taxonomy work: **a save that only moves a note in the taxonomy costs
   no Jina call**, which is exactly what the ring's background saves produce
   most of.

5. **Transaction** — `createNoteForUser` (`sql/note/add.ts`) opens an explicit
   transaction and:
   - `ensureCategoryIdForUser` — verifies the category exists _and belongs to
     this user_ (ownership is checked in application code, not by the schema);
   - `INSERT INTO user_note_v1 (...) RETURNING id`;
   - `replaceNoteTagsForNote` — verifies every tag id belongs to the user, then
     deletes and re-inserts all rows in `user_note_tag_link_v1` for the note;
   - `selectNoteById` re-reads the row through the canonical projection;
   - `COMMIT`.

`updateNoteForUser` is the same shape with an `UPDATE` whose `WHERE` includes
`user_id`; `rowCount !== 1` rolls back and returns `null`, which the route maps
to a 404.

There is **no optimistic locking**: no version column, no `If-Match`. Every save
is a full-document replacement and the last writer wins. With N notes open and
saving independently, that is now N concurrent writers rather than one.

## 1.3a The open-note ring

The client-side model that PR #69 introduced, because the taxonomy work has to
fit inside it. All of this lives in `apps/notes-next`.

**Entries, not a single form.** `src/stores/openNotes.ts` holds an MRU-ordered
array of `OpenNoteEntry`, each with its own `form`, `savedSignature`,
`saveStatus`, `categoryInputValue`, `pendingTagLabels` and `editorSessionId`.
The old flat `noteForm` / `editingNoteId` / `noteSaveStatus` fields are gone
from `notesAppStore`; what remains app-wide there is `resultsListVisible`,
`manuallyExpandedCategoryId`, `selectedTagId`, `searchQuery` and
`maxOpenNotes`.

**Identity is a key, not a note id.** `OpenNoteKey` is `note:${id}` once
persisted and `draft:${n}` before that. The key is deliberately stable across
the first save — the editor is keyed on it, and remounting CodeMirror
mid-typing would lose the cursor. `entry.noteId` goes from `null` to a real id
while the key stays put.

**Dirty is a signature comparison.** `serializeNoteDraft(noteId, form)` in
`src/lib/noteDraft.ts` produces a stable JSON string of exactly what would be
persisted; an entry is dirty when it differs from `entry.savedSignature`. The
note id is part of the signature, so the saved signature has to be recomputed
when a draft's first save assigns one.

**Saveable is a separate predicate.** `isSaveableForm` requires a non-empty
description **and** a non-null `selectedCategoryId`. An entry that is dirty but
not saveable is silently skipped by autosave.

**The save engine.** `src/hooks/useOpenNotesAutosave.ts` arms one trailing
3-second debounce per dirty entry, re-armed only when that entry's own
signature changes, so typing in one note cannot starve another's save.
`saveEntry(key, mode)` runs in three modes — `autosave` (debounced; a second
save of the same key queues behind the first, different keys run in parallel),
`flush` (awaited, only for session changes), and `detached` (an entry that left
the ring while dirty; its snapshot moves to `detachedSavesRef` so the request
still lands, and it is never retried because a repeated `POST` would create a
second note).

**Persistence.** `src/lib/openNotesStorage.ts` mirrors the ring to
`localStorage` under `notes-open-notes-v1`, deliberately separate from
`notesCache` because that cache expires and is wiped on session-restore
failure, either of which would destroy unsaved text. On load,
`reconcileOpenNotes` merges the snapshot against the server's notes: clean
entries adopt the server record, dirty entries keep the local draft, entries
whose note was deleted elsewhere become new drafts, and **references to
categories or tags that no longer exist are repaired to a fallback**.

**The invariant that governs all of it**, quoted from
`apps/notes-next/AGENTS.md`:

> a form change the _user_ did not make must never leave an entry dirty.
> Reconciliation, the category remap, and the sidebar move handlers all
> recompute `savedSignature` alongside the form — otherwise autosave
> immediately pushes the change back to the server.

**A failure mode already paid for.** Also from `AGENTS.md`: the ring was
manually tested across several sessions, demos included, while `user_note_v1`
was empty the entire time. Every session ran as a fresh anonymous user, a new
account had no category, so `isSaveableForm` was false and every autosave
returned before reaching the network. `localStorage` reproduced the notes
perfectly on reload and nothing looked wrong. The fix was
`ensureDefaultCategoryForUser`, called at the top of `listCategoriesForNotesApp`
so any user with zero categories gets `uncategorized` on their first
`GET /api/categories`. Section 6.4 explains why a three-level chain makes this
trap materially worse and what the plan does about it.

## 1.4 The read path

All note reads share one projection in `sql/note/shared.ts`:

```sql
SELECT n.id, n.user_id,
       json_build_object('id', cat.id, 'label', cat.label) AS category,
       n.description, n.time_due, n.time_remind, n.time_created, n.time_modified,
       COALESCE((SELECT json_agg(json_build_object('id', c.id, 'label', c.label)
                                 ORDER BY lower(c.label), c.id)
                 FROM user_note_tag_link_v1 l
                 JOIN user_note_tag_v1 c ON c.id = l.tag_id AND c.user_id = n.user_id
                 WHERE l.note_id = n.id), '[]'::json) AS tags
FROM user_note_v1 n
JOIN user_note_category_v1 cat ON cat.id = n.category_id AND cat.user_id = n.user_id
```

The category is inlined as a JSON object and the tags as a JSON array, so
`NoteRecord` arrives fully denormalized in a single row. `mapNote` converts
timestamps to ISO strings.

Category and tag lists are returned by `listCategoriesByUser` /
`listTagsByUser`, which decorate each row with a correlated `noteCount` and a
`lastUsedAt` (`MAX(n.time_modified)`), ordered `last_used_at DESC NULLS LAST,
lower(label) ASC, id ASC`.

## 1.5 Taxonomy invariants maintained in application code

These are _not_ in the schema — they live in `services/notes-app.ts`:

- **Labels are normalized** to `trim().toLocaleLowerCase()` at every write
  boundary; the DB only has a `CHECK` that rejects anything else.
- **Every user gets an `important` tag.** Seeded by migration
  `202606101200__seed_default_important_tag.sql`, re-asserted by
  `ensureDefaultTagForUser` on every tag list, and asserted as a data invariant
  by `db:verify`.
- **Every user gets an `uncategorized` category.** Added by PR #69:
  `ensureDefaultCategoryForUser` (`sql/category.ts`) inserts it at the top of
  `listCategoriesForNotesApp`, but only when the user has no categories at all,
  so existing accounts are untouched. This is a lazy repair on a read path, not
  a migration — the pattern the taxonomy work should copy.
- **"Default" category/tag = lowest numeric id** (`getFirstCategoryForUser`
  orders by `id ASC LIMIT 1`). The client mirrors this in
  `getDefaultCategoryId`, which reduces the loaded list to the smallest id.
- **The fallback category cannot be deleted.** `deleteCategoryForUser` reassigns
  the category's notes to the fallback category, then deletes it;
  `deleteCategoryWithNotesForUser` deletes the notes instead. Both refuse when
  the target _is_ the fallback.
- **`ensureFallbackCategoryId` throws** if a user somehow has no categories at
  all. Nothing in the schema guarantees a user has one.

## 1.6 Embedding lifecycle

Provider Jina AI, model `jina-embeddings-v5-text-small`, 1024 dims, normalized,
no manual `Query:`/`Document:` prefixes (the `task` parameter selects the LoRA
adapter). Model tag stored per row as `…:notes-v3`.

| Entity       | Embedded text | Column                  | Written on                     |
| ------------ | ------------- | ----------------------- | ------------------------------ |
| Note         | `description` | `description_embedding` | every create/update (blocking) |
| Category     | `label`       | `category_embedding`    | create + rename                |
| Tag          | `label`       | `tag_embedding`         | create + rename                |
| Search query | user query    | not stored              | per search (`retrieval.query`) |

Two repair paths exist:

- `POST /api/notes/maintenance/embeddings` with `mode: "missing" | "stale"` →
  `maintainNoteEmbeddingsForNotesApp`, which walks categories, tags, and notes.
  `"stale"` means `embedding_model IS DISTINCT FROM` the current model tag.
- `scripts/regenerate-embeddings.mjs` — bulk CLI regeneration. **It covers tags
  and notes but not categories**, an existing inconsistency worth fixing while
  the taxonomy is reworked.

The anonymous→real merge inserts categories and tags with raw SQL, bypassing
embed-on-write, so `mergeAnonymousNotesAppSession` runs a best-effort
`mode: "missing"` backfill after the merge commits.

## 1.7 Semantic search today

`searchNotesByEmbedding` (`sql/note/gets.ts`) computes a composite score:

```
score = COALESCE(description_similarity, 0) * 0.67
      + COALESCE(avg(category_similarity, tag_similarity), 0) * 0.33
```

`description_similarity` is `1 - (description_embedding <=> query)`;
`category_similarity` is the same against the note's single category label
vector; `tag_similarity` is the `AVG` over the note's linked tag vectors, via a
correlated subquery per note. The taxonomy term is the arithmetic mean of
whichever of the two is non-null.

Every note for the user is returned, ordered by score then `time_modified`, up
to `limit` (default and max 20, `NOTES_APP_SEARCH_MAX_RESULTS`). Notes with no
embedding score 0 and still appear after better matches.

`SemanticSearchResult` carries `{ note, similarity, tagSimilarity,
descriptionSimilarity }`. The SQL also computes `category_similarity`, but the
contract never exposes it. `NoteResultsList.tsx` renders `similarity` as a
percentage badge.

`app/api/embeddings/debug/route.ts` and `app/embeddings/page.tsx` reimplement the
same `0.67 / 0.33` formula standalone against Jina, with selectable search and
passage tasks, for tuning experiments.

## 1.8 Source-of-truth pipeline

Schema changes flow through a fixed, checked pipeline:

1. `pnpm --filter @lib/db-notes db:migration:new -- <name>` scaffolds
   `migrations/YYYYMMDDHHMM__<name>.sql`.
2. `db:migrate` applies files in lexicographic order, tracking
   `filename + sha256 + applied_at` in `public.schema_migrations_cursor`. An
   edit to an already-applied file fails with a checksum mismatch. Each file is
   wrapped in a transaction unless it contains `-- cursor:no-transaction`.
3. `db:verify` runs migrate → `snapshot-schema.sh` → `generate-types.mjs` →
   `generate-app-contract.mjs --write`, then asserts the live schema, then fails
   if any generated artifact differs from git.

Committed derived artifacts: `schema/current.sql`,
`generated/typescript/db-types.ts`, `generated/contracts/db-schema.json`,
`generated/contracts/notes-app.json`.

Two guards will fire on this work and must be satisfied deliberately:

- **`MERGE_TABLE_STRATEGIES` guard** — `db:verify` diffs the registry in
  `sql/user/anonymous.ts` against every table with an FK to `user_v1`. A new
  user-owned table fails the build until a merge strategy is declared.
- **Android contract validator** — `apps/notes-android/tools/validate-notes-contract.mjs`
  checks `Models.kt` field _order_, names and Kotlin types, `JsonCodec.kt`
  decoder order, and required payload snippets in `NotesApiClient.kt` against
  `generated/contracts/notes-app.json`. Any contract change breaks
  `pnpm --filter notes-android contracts:check`.

---

# Part 2 — Target model

## 2.1 Requirements

1. Four levels: **Epic > Category > Group > Note**.
2. Every child belongs to **exactly one** parent, at every level: a Note is in
   one Group, a Group is in one Category, a Category is in one Epic.
3. Tags stay **many-to-many** on notes, unchanged.
4. **Every taxonomy level gets a label embedding**, so the UI can autocomplete
   as the user types a name at any level.
5. Semantic note search compares the query **only** against the note text
   embedding. The category/tag terms and the `0.67 / 0.33` weighting are
   removed.
6. **The level names are per-user data, not code.** "Epic", "Category", "Group"
   are labels the user can rename, and so is "Note" — which is what lets the
   same app manage tasks, or anything else, without a schema change. The program
   branches only on the level _number_; the label is display text. Section 2.3.
7. Auto-created placeholder items are labelled `uncategorized` at every level,
   matching the existing flat-category default.

## 2.2 Two designs considered

**Option A — three sibling tables.** `user_note_epic_v1`, keep
`user_note_category_v1` and add `epic_id`, add `user_note_group_v1`, point
`user_note_v1` at a group.

- Depth is enforced by the FK types themselves; nothing extra needed.
- Keeps the existing category table intact, so the migration is smaller.
- But it triples almost everything: three near-identical tables each with
  `label_embedding` / `embedding_model` / `embedding_updated_at` and an HNSW
  index, three sets of CRUD SQL, three list/missing/stale embedding queries,
  three route files, three Kotlin models, three merge-strategy entries. Adding a
  fifth level later means doing it all a fourth time.

**Option B (recommended) — one self-referencing table.** A single
`user_taxonomy_v1` with `level smallint` (1=epic, 2=category, 3=group) and
`parent_id`, and notes pointing at a level-3 row.

- One table, one embedding column, one CRUD surface, one autocomplete endpoint,
  one merge-strategy entry. The level is a parameter, not a code path — which
  matches how the service layer is already written (`createLabeledEntityForNotesApp`
  is already parameterized by `tableName`).
- The whole tree for a user is one indexed round trip; roll-ups are one
  recursive CTE.
- Adding or renaming a level later is a data/config change, which fits the
  stated product direction of growing well beyond notes.
- The usual objection — "a `parent_id` column can't stop you from parenting an
  epic under a category" — does not apply here. Section 2.4 makes depth,
  parent level, _and_ per-user ownership fully declarative, with no triggers.
  Section 2.6 shows every violation being rejected by Postgres.

The remaining honest cost of Option B is that ancestor lookups need a join per
level (or a recursive CTE for arbitrary-depth roll-ups) rather than a single
typed FK, and that the migration has to move the existing category rows into the
new table instead of leaving them where they are. Both are handled below and
neither showed up as a performance problem in the prototype.

**Table naming.** The two new tables are `user_taxonomy_v1` and
`user_taxonomy_level_v1` — deliberately without the `user_note_` prefix that
every existing table carries. The hierarchy is content-agnostic by design: it is
a tree of labels, and which content hangs off its leaves is the point of the
renameable level-4 word. `user_note_v1` keeps its name as the notes content
table, leaving room for a `user_task_v1` beside it later. These are new tables,
so naming them right now costs nothing, whereas renaming later costs a
migration. `user_note_tag_v1` is arguably in the same position but is not worth
a rename on its own; leave it.

**Fixed depth, renameable names.** The four tiers are renameable but their
_count_ is fixed at three containers plus the leaf. That is deliberate: the
`group_level = 3` pin in section 2.4 is what makes "a note attaches only to a
group" a declarative guarantee rather than an application check. Variable depth
would mean giving that up for a trigger or app-level validation. Renaming covers
the stated requirement; if variable depth is wanted later it is a migration plus
a conscious loss of that constraint.

## 2.3 Tier vocabulary: the level names belong to the user

There are **two different kinds of label** in this design, and keeping them
apart is the whole point of this section:

|                | What it names     | Example                         | Keyed by           | Where it lives           |
| -------------- | ----------------- | ------------------------------- | ------------------ | ------------------------ |
| **Tier label** | the tier itself   | "Epic", or "Project", or "Area" | `(user_id, level)` | `user_taxonomy_level_v1` |
| **Item label** | one row in a tier | "work", "home", "uncategorized" | row id             | `user_taxonomy_v1.label` |

Tier labels are per-user and renameable. `level` — a small integer — is the only
thing the program ever branches on; the label is display text the user controls.
That is what makes the same schema serve notes, tasks, or anything else: one
person's levels read Epic / Category / Group / Note, another's read
Portfolio / Project / Sprint / Task, and the code cannot tell the difference.

Level 4 is included in the vocabulary because the **leaf content type is also a
renameable word**. Level 4 has no rows in `user_taxonomy_v1` — it names the
content in `user_note_v1`. That is how "Note" becomes "Task" without a schema
change.

```sql
CREATE TABLE public.user_taxonomy_level_v1 (
    user_id integer NOT NULL,
    level smallint NOT NULL,
    label text NOT NULL,
    time_created timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    time_modified timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- (user_id, level) is both the identity and the FK target used by the
    -- hierarchy table in section 2.4
    CONSTRAINT user_taxonomy_level_v1_pkey PRIMARY KEY (user_id, level),

    CONSTRAINT user_taxonomy_level_v1_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES public.user_v1(id) ON DELETE CASCADE,

    -- 1..3 are containers; 4 names the leaf content type
    CONSTRAINT user_taxonomy_level_v1_level_check
      CHECK (level >= 1 AND level <= 4),

    CONSTRAINT user_taxonomy_level_v1_label_not_blank_check
      CHECK (label = btrim(label) AND label <> '')
);

-- two tiers must not share a name, or the UI becomes ambiguous
CREATE UNIQUE INDEX user_taxonomy_level_v1_user_id_label_lower_idx
  ON public.user_taxonomy_level_v1 (user_id, lower(label));

CREATE TRIGGER user_taxonomy_level_v1_apply_row_timestamps_v1
BEFORE INSERT OR UPDATE ON public.user_taxonomy_level_v1
FOR EACH ROW EXECUTE FUNCTION public.apply_row_timestamps_v1();
```

**Defaults.** Tier labels seed to `Epic` / `Category` / `Group` / `Note`. Item
labels for the rows the migration auto-creates all seed to `uncategorized`, at
every level, matching the existing flat-category default.

**Case handling deliberately differs between the two label kinds.** Item labels
keep the existing `CHECK (label = lower(btrim(label)))`, because the
upsert-by-label pattern depends on a deterministic form. Tier labels preserve
the case the user typed, and are only checked for blankness — they are headings,
and `user_taxonomy_level_v1` is keyed by `(user_id, level)`, so there is no
upsert-by-label to keep deterministic. Uniqueness is enforced on `lower(label)`
so "Group" and "group" cannot both exist as tier names.

**No embeddings on tier labels.** Item labels get `label_embedding` for
autocomplete because they are content the user searches through. Tier labels are
four pieces of UI chrome renamed in settings; embedding them would serve nothing.

**Referential integrity.** The hierarchy table carries a composite FK
`(user_id, level)` → `user_taxonomy_level_v1 (user_id, level)`. This buys two
guarantees, both verified: a taxonomy row cannot exist at a level the user has
no name for, and a tier definition cannot be deleted while rows still sit at
that tier. `ON DELETE RESTRICT` on that FK does **not** interfere with deleting
a user, even though both tables cascade from `user_v1` — Postgres settles the
whole cascade wave from one statement before evaluating the check. That was
tested explicitly across `NO ACTION`, `RESTRICT` and `CASCADE`, and across both
table-creation orders, because RI trigger firing order follows creation order;
all six combinations left zero orphans.

### The guardrail that matters most

**Never branch on a tier label, only on `level`.** The label is user-editable
free text, so any code that compares it, switches on it, or embeds it in a
durable identifier breaks the moment someone renames a tier. Concretely:

- API filters, query parameters and cache keys use `level` (and row ids), never
  labels. The hierarchical URL state in section 7.1 must be
  `?epic=<id>&category=<id>&group=<id>` — id-based, and it should keep those
  parameter names regardless of what the user calls the tiers, or a rename
  invalidates every bookmark.
- The UI reads all four words from the API. Today they are hardcoded English
  literals — `<div className={styles.accordionHeading}>Categories</div>`,
  `aria-label="Notes by category"`, "Add note", and so on: roughly two dozen
  such strings across eight files, listed in section 7.1.
- Singular only (decision 4.4-7). The table stores one word per tier and the UI
  renders it verbatim — a sidebar heading reads `Category`, not `Categories`.
  There is no pluralization step and no `label_plural` column, because guessing
  a plural for a word the user invented is a bug generator. Adding the column
  later is additive if it ever matters.

## 2.4 Recommended schema: the hierarchy table

```sql
CREATE TABLE public.user_taxonomy_v1 (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id integer NOT NULL,
    level smallint NOT NULL,                       -- 1 epic, 2 category, 3 group
    parent_id integer,
    parent_level smallint GENERATED ALWAYS AS (level - 1) STORED,
    label text NOT NULL,
    label_embedding public.vector(1024),
    embedding_model text,
    embedding_updated_at timestamp with time zone,
    time_created timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    time_modified timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT user_taxonomy_v1_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES public.user_v1(id) ON DELETE CASCADE,

    -- only container tiers live in this table; level 4 names the leaf content
    CONSTRAINT user_taxonomy_v1_level_check
      CHECK (level >= 1 AND level <= 3),

    -- a row may only exist at a tier this user has a name for, and a tier
    -- definition cannot be dropped while rows still sit at it (see section 2.3)
    CONSTRAINT user_taxonomy_v1_level_fkey
      FOREIGN KEY (user_id, level)
      REFERENCES public.user_taxonomy_level_v1 (user_id, level)
      ON DELETE RESTRICT,

    CONSTRAINT user_taxonomy_v1_label_lowercase_check
      CHECK (label = lower(btrim(label))),

    -- exactly the roots have no parent, and only roots may have none
    CONSTRAINT user_taxonomy_v1_root_parent_check
      CHECK ((level = 1) = (parent_id IS NULL)),

    -- target of the self-referencing composite FK below; user_id is part of the
    -- key so "parent must belong to the same user" is declarative too
    CONSTRAINT user_taxonomy_v1_id_level_user_key
      UNIQUE (id, level, user_id),

    CONSTRAINT user_taxonomy_v1_parent_fkey
      FOREIGN KEY (parent_id, parent_level, user_id)
      REFERENCES public.user_taxonomy_v1 (id, level, user_id)
      ON DELETE RESTRICT,

    -- NULLS NOT DISTINCT (PG15+) so the constraint also applies to level-1 rows
    CONSTRAINT user_taxonomy_v1_sibling_label_key
      UNIQUE NULLS NOT DISTINCT (user_id, level, parent_id, label)
);
```

The mechanism worth understanding: `parent_level` is a stored generated column
always equal to `level - 1`, and the composite FK points at `(id, level,
user_id)`. So a row can only be parented to a row that is _exactly one level up_
and owned by the _same user_. For level-1 rows `parent_id` is `NULL`, and
default `MATCH SIMPLE` semantics skip the FK entirely, which is what the
`root_parent_check` then pins down. No triggers, no application-side depth
checks.

Indexes:

```sql
CREATE INDEX user_taxonomy_v1_user_id_level_idx
  ON public.user_taxonomy_v1 (user_id, level);

CREATE INDEX user_taxonomy_v1_parent_id_idx
  ON public.user_taxonomy_v1 (parent_id);

-- one partial HNSW index per level, so level-scoped autocomplete never has to
-- post-filter a mixed-level index
CREATE INDEX user_taxonomy_v1_epic_embedding_hnsw_idx
  ON public.user_taxonomy_v1 USING hnsw (label_embedding public.vector_cosine_ops)
  WHERE level = 1;
-- …_category_embedding_hnsw_idx WHERE level = 2
-- …_group_embedding_hnsw_idx    WHERE level = 3

CREATE TRIGGER user_taxonomy_v1_apply_row_timestamps_v1
BEFORE INSERT OR UPDATE ON public.user_taxonomy_v1
FOR EACH ROW EXECUTE FUNCTION public.apply_row_timestamps_v1();
```

A measured caveat on those HNSW indexes: at realistic taxonomy sizes the planner
correctly prefers a sequential scan (a user with a few thousand groups still
sorts in well under a millisecond), so they buy nothing today. They are cheap
(24 kB each in the prototype) and they are the right shape if a user ever grows
a very large taxonomy. **If you prefer to keep the schema minimal, dropping all
three and relying on `user_taxonomy_v1_user_id_level_idx` is a defensible
call** — just make the same choice in `verify-contract.mjs`.

Notes attach to groups:

```sql
ALTER TABLE public.user_note_v1 ADD COLUMN group_id integer;
ALTER TABLE public.user_note_v1 ADD COLUMN group_level smallint NOT NULL DEFAULT 3;
ALTER TABLE public.user_note_v1
  ADD CONSTRAINT user_note_v1_group_level_check CHECK (group_level = 3);
ALTER TABLE public.user_note_v1
  ADD CONSTRAINT user_note_v1_group_id_fkey
    FOREIGN KEY (group_id, group_level, user_id)
    REFERENCES public.user_taxonomy_v1 (id, level, user_id)
    ON DELETE RESTRICT;
CREATE INDEX user_note_v1_group_id_idx ON public.user_note_v1 (group_id);
```

`group_level` is a constant column pinned to 3 by a `CHECK`. It exists purely so
the composite FK can express "this must be a level-3 row belonging to this
note's own user". That single constraint replaces
`ensureCategoryIdForUser`'s application-side ownership check _and_ guarantees
notes can never be attached to an epic or a category.

## 2.5 Resulting relationships

| Relationship                | Cardinality       | Enforced by                                    |
| --------------------------- | ----------------- | ---------------------------------------------- |
| user → tier definitions     | one per level 1–4 | `user_taxonomy_level_v1` PK `(user_id, level)` |
| taxonomy row → its tier     | **exactly one**   | `user_taxonomy_v1_level_fkey`                  |
| user → taxonomy rows        | one-to-many       | `user_id` FK, `ON DELETE CASCADE`              |
| epic → categories           | one-to-many       | composite parent FK, `level` 1→2               |
| category → groups           | one-to-many       | composite parent FK, `level` 2→3               |
| group → notes               | one-to-many       | `user_note_v1_group_id_fkey`                   |
| category → epic             | **exactly one**   | `parent_id` NOT NULL for `level > 1`           |
| group → category            | **exactly one**   | same                                           |
| note → group                | **exactly one**   | `group_id` NOT NULL + FK                       |
| note ↔ tags                | **many-to-many**  | `user_note_tag_link_v1`, unchanged             |
| parent and child same owner | always            | `user_id` in the composite FK                  |

## 2.6 Verified constraint behavior

Every case below was executed against PostgreSQL 17.11 + pgvector 0.8.6 on the
prototype schema with seeded data. "Rejected by" names the constraint that
actually fired.

| Attempt                                            | Result                         | Rejected by                                       |
| -------------------------------------------------- | ------------------------------ | ------------------------------------------------- |
| Epic parented under a category                     | rejected                       | `root_parent_check`                               |
| Group parented directly under an epic (level skip) | rejected                       | `parent_fkey`                                     |
| Category parented under **another user's** epic    | rejected                       | `parent_fkey`                                     |
| Level-1 row given a parent                         | rejected                       | `root_parent_check`                               |
| Level-2 row with no parent                         | rejected                       | `root_parent_check`                               |
| Duplicate label among siblings                     | rejected                       | `sibling_label_key`                               |
| Duplicate epic label (both `parent_id` NULL)       | rejected                       | `sibling_label_key` (proves `NULLS NOT DISTINCT`) |
| Same label under _different_ parents               | **accepted**                   | —                                                 |
| Note attached to a category instead of a group     | rejected                       | `user_note_v1_group_id_fkey`                      |
| Note attached to another user's group              | rejected                       | `user_note_v1_group_id_fkey`                      |
| Note with hand-tampered `group_level = 1`          | rejected                       | `group_level_check`                               |
| Re-parenting a category to another user's epic     | rejected                       | `parent_fkey`                                     |
| Deleting a category that still has groups          | rejected                       | `parent_fkey` (RESTRICT)                          |
| Uppercase item label                               | rejected                       | `label_lowercase_check`                           |
| Deleting the user                                  | **cascades** the whole subtree | `user_id` FK                                      |

And for the tier vocabulary of section 2.3:

| Attempt                                                                                                   | Result                                                   | Rejected by                          |
| --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------ |
| Taxonomy row at a tier the user has no name for                                                           | rejected                                                 | `user_taxonomy_v1_level_fkey`        |
| Deleting a tier definition that still has rows at it                                                      | rejected                                                 | `user_taxonomy_v1_level_fkey`        |
| Tier outside 1..4                                                                                         | rejected                                                 | `user_taxonomy_level_v1_level_check` |
| Two definitions for the same `(user_id, level)`                                                           | rejected                                                 | `user_taxonomy_level_v1_pkey`        |
| Two tiers named the same, case-insensitively                                                              | rejected                                                 | `user_id_label_lower_idx`            |
| Blank or untrimmed tier name                                                                              | rejected                                                 | `label_not_blank_check`              |
| Renaming a tier (levels 1 and 4)                                                                          | **accepted**, one `UPDATE`, taxonomy row count unchanged | —                                    |
| Two users with different vocabularies over identical data                                                 | **accepted**                                             | —                                    |
| Deleting a user, with `NO ACTION` / `RESTRICT` / `CASCADE` on the level FK, in both table-creation orders | **cascades cleanly, 0 orphans in all 6 combinations**    | —                                    |

That last row is why the FK action could be chosen on intent rather than
mechanics. The initial assumption was that `RESTRICT` would fire mid-cascade when
a user was deleted and that `NO ACTION` was therefore required; testing showed
all three actions work, in both creation orders, so `RESTRICT` was chosen to
match the rest of the schema and to give an immediate, clearer error.

`pg_dump` round-trips all of it — the generated column, all three composite FKs,
`UNIQUE NULLS NOT DISTINCT`, and the functional unique index on `lower(label)`
reappear verbatim — so `snapshot-schema.sh` and the `db:verify` artifact diff
work unchanged. `generate-types.mjs` already maps `int2` to `number`, so `level`
and `parent_level` need no generator change.

---

# Part 3 — Migration plan

Two migrations, deliberately split. `manifest.yaml` declares an
`additive-first` compatibility policy, and Railway migrates the database before
the app deploy, so phase 1 must leave the currently-deployed code working.

## 3.1 Phase 1 — additive (deploy with, or before, the new code)

`migrations/<stamp>__note_taxonomy_hierarchy.sql`:

1. Create `user_taxonomy_level_v1` (section 2.3) and `user_taxonomy_v1`
   (section 2.4) with all constraints, indexes, and timestamp triggers.
2. **Seed the tier vocabulary for every user** — `Epic` / `Category` / `Group` /
   `Note` at levels 1–4. This must come before any hierarchy row, because the
   composite level FK will reject a taxonomy row at an unnamed tier.
3. **One epic per user**, for _every_ row in `user_v1` — not only users who
   already have categories. This is what finally guarantees the fallback chain
   always resolves, removing the `ensureFallbackCategoryId` "should never
   happen" throw. It follows the precedent of
   `202606101200__seed_default_important_tag.sql`.
4. **Every existing category becomes a level-2 row** under that user's epic,
   preserving the label. The old table's `UNIQUE (user_id, label)` makes a label
   join a safe 1:1 mapping, so no temporary id-mapping column is needed.
5. **Backstop**: any epic with no categories gets an `uncategorized` category, so
   users with zero categories are also complete.
6. **One `uncategorized` group under every category**, giving existing notes a
   home.
7. Add `user_note_v1.group_id` (nullable) and `group_level` (default 3, pinned
   by `CHECK`), backfill `group_id` by joining old category → new level-2 row →
   its `uncategorized` group, then `SET NOT NULL`, add the composite FK, add the
   index.

The old `user_note_category_v1` table and `user_note_v1.category_id` are
untouched, so the currently-deployed app keeps working against them.

New users need the same vocabulary seed at creation time — add it to
`createAnonymousUser` and any other user-insert path, in the same transaction,
or the first taxonomy write for that user will fail the level FK.

**Verified on seeded data**: 2 users, 4 categories, 6 notes including one with a
`NULL` description and one anonymous user's note. The migration applied in a
single transaction and backfilled all 6 notes with no nulls left; the resulting
tree read back correctly through a three-level join with every auto-created item
labelled `uncategorized`.

**Item label for the auto-created rows: `uncategorized` at every level**
(decided). It matches the current flat-category default, and sibling-scoped
uniqueness means an `uncategorized` epic, an `uncategorized` category beneath it
and an `uncategorized` group beneath that coexist without conflict — including
for the users who already own a category literally named `uncategorized`, which
was verified. Note this is the _item_ default; the _tier_ defaults are the words
Epic / Category / Group / Note per section 2.3.

## 3.2 Phase 2 — cutover (only after the new code is live)

`migrations/<stamp>__drop_flat_note_categories.sql`:

```sql
ALTER TABLE public.user_note_v1 DROP CONSTRAINT user_note_v1_category_id_fkey;
DROP INDEX public.user_note_v1_category_id_idx;
ALTER TABLE public.user_note_v1 DROP COLUMN category_id;
DROP TABLE public.user_note_category_v1;
```

Verified to apply cleanly against the phase-1 database. Keeping `category_id`
around any longer than necessary invites drift, because nothing keeps it in sync
with the group's parent once writes go through `group_id`.

## 3.3 `verify-contract.mjs`

The script is 654 lines of explicit assertions and is the most common cause of a
failing `db:verify`. Additions needed, following the existing block styles:

- `user_taxonomy_v1` and `user_taxonomy_level_v1` added to the expected-tables
  `IN` list.
- Column type and nullability assertions for `level`, `parent_id`,
  `parent_level`, `label`, `label_embedding`, `embedding_model`,
  `embedding_updated_at`, and for the level table's `user_id`, `level`, `label`.
- Named-constraint counts (`pg_constraint`) for `user_id_fkey`, `level_check`,
  `label_lowercase_check`, `root_parent_check`, `id_level_user_key`,
  `parent_fkey`, `sibling_label_key`, `user_taxonomy_v1_level_fkey`, the level
  table's `pkey`, `level_check`, `label_not_blank_check` and `user_id_fkey`, plus
  `user_note_v1_group_id_fkey` and `user_note_v1_group_level_check`.
- Named-index counts (`pg_indexes`) for `user_id_level_idx`, `parent_id_idx`,
  the three partial HNSW indexes (if kept),
  `user_taxonomy_level_v1_user_id_label_lower_idx`, and
  `user_note_v1_group_id_idx`.
- Both new trigger names added to the existing `tgname IN (…)` list.
- **Structural data invariants**, in the spirit of the existing "every user must
  have the default important tag" check. These catch a broken backfill, which
  named-object assertions cannot:
  - **every user has all four tier definitions** (levels 1–4) — the direct
    analogue of the existing important-tag invariant, and the one that catches a
    user-creation path that forgot to seed the vocabulary;
  - no two tier definitions for one user share a `lower(label)`;
  - no row where `level > 1 AND parent_id IS NULL`, and none where
    `level = 1 AND parent_id IS NOT NULL`;
  - no row whose parent has a `level` other than `level - 1`;
  - no row whose parent has a different `user_id`;
  - every user has at least one level-1, one level-2 and one level-3 row;
  - every note's `group_id` resolves to a level-3 row of the same user.
- **Phase 2 flips**: replace the `user_note_category_v1` and
  `user_note_v1.category_id` must-exist assertions with must-be-absent
  assertions (count must be 0), as the script already does for the legacy
  `user_note_v1.tag` column.

## 3.4 Anonymous merge

`db:verify` will fail until **both** new tables are added to
`MERGE_TABLE_STRATEGIES`, since both carry an FK to `user_v1`.

`user_taxonomy_v1` is `dedup-remap`, but the merge SQL in
`mergeAnonymousUserInto` needs real work: today it dedupes one flat category list
by label in a single pass. It now has to walk **three levels in order**, because
a level-2 row cannot be inserted until its parent's real id is known:

1. Merge epics by label → build `anonEpicId → realEpicId`.
2. Merge categories by `(remapped parent, label)` → build the category remap.
3. Merge groups by `(remapped parent, label)` → build the group remap.
4. Reparent notes: `user_id = real` and `group_id = remapped`.
5. Remap tag links (unchanged).
6. Delete the anonymous row; `CASCADE` clears the leftover subtree.

Two things to preserve from the current implementation: the `FOR UPDATE` locks
that serialize a merge against a concurrent claim, and the hard-won rule that
the inlined `VALUES` remap statements must not be passed unused bind parameters
(that bug aborted every merge in production once).

`user_taxonomy_level_v1` is `drop` — **decided**. The destination account's tier
vocabulary wins; an anonymous visitor's rename does not survive the merge. This
is a deliberate divergence from the "anon wins" rule on preferences, on the
grounds that silently renaming every tier in an established account is a far
bigger surprise than inheriting a column width.

The same decision fixes the merge's semantics generally: **merge final state by
label, and do not track how that state was reached.** No rename history, no
attempt to recognize that an anon row "is really" a destination row under a new
name. Concretely, if a visitor started from a category that also exists in the
destination account and then renamed it, the renamed category merges in as a
**separate second row** alongside the original. That is exactly what
`dedup-remap` already does — dedup is by final label, and a renamed label simply
does not collide — so the level-ordered walk above needs no extra machinery. It
is worth stating explicitly because the alternative (matching on identity to
"follow" a rename) is a plausible-sounding design that this decision rejects.

Note that the merge order now matters for a new reason: the destination user
already has tier definitions, so no level rows need creating, but the level FK
means any taxonomy row inserted for the destination user must find a definition
— which it will. Worth an assertion in the test rather than an assumption.

`testing/anonymous-merge.test.ts` needs cases for a multi-level subtree, for
same-label groups under different categories, for a partial-overlap tree
(shared epic, new category), and for an anonymous user who renamed a tier
(asserting the destination account's vocabulary survives).

---

# Part 4 — Contract, API and service changes

## 4.1 `contracts/notes-app.ts`

```ts
// The only stable identity of a tier. Names are user data; these are not.
export const TAXONOMY_LEVEL_EPIC = 1
export const TAXONOMY_LEVEL_CATEGORY = 2
export const TAXONOMY_LEVEL_GROUP = 3
export const TAXONOMY_LEVEL_CONTENT = 4 // names the leaf content type

export const DEFAULT_TAXONOMY_LEVEL_LABELS = {
  1: "Epic",
  2: "Category",
  3: "Group",
  4: "Note",
} as const

export interface TaxonomyLevelRecord {
  userId: number
  level: number // 1..4
  label: string // display text, user-editable; never branch on this
}

export interface TaxonomyRecord {
  id: number
  userId: number
  level: number // 1 epic, 2 category, 3 group
  parentId: number | null
  label: string
  noteCount: number // rolled up over the whole subtree
  directNoteCount: number // notes attached directly (0 unless level 3)
  lastUsedAt: string | null
}

export interface TaxonomyRef {
  id: number
  label: string
}

export interface NoteRecord {
  id: number
  userId: number
  group: TaxonomyRef
  category: TaxonomyRef // group's parent, denormalized for display
  epic: TaxonomyRef // category's parent
  tags: NoteTagRef[] // unchanged
  description: string | null
  timeDue: string | null
  timeRemind: string | null
  timeCreated: string
  timeModified: string
}

export interface NoteInput {
  groupId: number // was categoryId
  tagIds: number[] // unchanged
  description: string
  timeDue: string | null
  timeRemind: string | null
}

export interface SemanticSearchResult {
  note: NoteRecord
  similarity: number // tagSimilarity and descriptionSimilarity removed
}
```

`CategoryRecord` and `NoteCategoryRef` go away. Keeping `category` and `epic` as
denormalized refs on `NoteRecord` preserves today's "render a note row without a
second lookup" property, which every list view depends on.

Two `noteCount` fields are needed because the UI wants both: a rolled-up count
for tree nodes (an epic showing the total beneath it) and a direct count for the
group actually holding the notes. Section 2.6's recursive CTE computes both.

`TaxonomyLevelRecord` is what lets every client render the user's own words. It
must be delivered on the initial load rather than fetched lazily, or the UI
flashes default English before correcting itself. The natural home is the session
payload — `SessionResponse` already carries `UserSummary`, so adding
`taxonomyLevels: TaxonomyLevelRecord[]` there gets the vocabulary to the client
in a request that already happens. Note that `notes-app.json` is generated from
these interfaces, and the Android validator checks field order, so add fields at
the end of existing interfaces rather than in the middle.

## 4.2 Routes

| Route                                    | Change                                                                                                        |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `GET /api/taxonomy`                      | new; returns the user's whole tree as a flat `TaxonomyRecord[]` (the client builds the tree — one round trip) |
| `POST /api/taxonomy`                     | new; `{ level, parentId, label }`                                                                             |
| `PATCH /api/taxonomy`                    | new; rename (`{ id, label }`) **and** move (`{ id, parentId }`)                                               |
| `DELETE /api/taxonomy`                   | new; needs an explicit child/note disposition — see 4.4                                                       |
| `POST /api/taxonomy/suggest`             | new; level-scoped label autocomplete                                                                          |
| `GET /api/taxonomy/levels`               | new; the user's tier vocabulary (also folded into the session payload)                                        |
| `PATCH /api/taxonomy/levels`             | new; rename a tier — `{ level, label }`. 409 on a duplicate name                                              |
| `GET/POST/PATCH/DELETE /api/categories`  | removed at phase 2; see the compatibility note below                                                          |
| `DELETE /api/categories/with-notes`      | folded into `DELETE /api/taxonomy`                                                                            |
| `POST /api/notes`, `PATCH /api/notes`    | `note.categoryId` → `note.groupId`                                                                            |
| `GET /api/notes`                         | response gains `group` / `category` / `epic`                                                                  |
| `POST /api/notes/search`                 | response loses `tagSimilarity` / `descriptionSimilarity`                                                      |
| `POST /api/notes/maintenance/embeddings` | counts now cover three taxonomy levels                                                                        |
| `POST /api/embeddings/debug`             | drop the composite formula                                                                                    |
| `GET/POST/PATCH/DELETE /api/tags`        | **unchanged**                                                                                                 |

**Compatibility note.** A released APK in the wild talks to the deployed
`notes-next` and will break the moment `/api/categories` stops answering.
`AGENTS.md` positions the Android app as an experiment to be updated after the
web app stabilizes, so breaking it is acceptable — but it should be a decision,
not a surprise. The cheap mitigation is to keep `GET /api/categories` alive as a
thin read-only alias projecting level-2 rows to the old `CategoryRecord` shape
until the APK is rebuilt.

## 4.3 SQL and service layer

- **`sql/taxonomy.ts` replaces `sql/category.ts`**, level-parameterized:
  `listTaxonomyByUser` (whole tree + both counts in one recursive CTE),
  `getTaxonomyByIdForUser`, `resolveTaxonomyIdForUser(level, parentId, label)`
  (the existing `INSERT … ON CONFLICT DO NOTHING … UNION ALL SELECT` upsert
  shape, now keyed on `(user_id, level, parent_id, label)`),
  `updateTaxonomyLabelForUser`, `moveTaxonomyNode`,
  `deleteTaxonomyNodeForUser`, `listTaxonomyMissingEmbeddingsByUser`,
  `listTaxonomyStaleEmbeddingsByUser`, `updateTaxonomyEmbeddingById`,
  `getFirstTaxonomyChildForUser(level, parentId)`.
- **`sql/note/shared.ts`** — `noteSelect` joins the group, its parent and its
  grandparent, emitting three `json_build_object`s. `ensureCategoryIdForUser`
  can be **deleted**: the composite FK now enforces exactly what it checked.
- **`sql/note/{add,update}.ts`** — write `group_id` instead of `category_id`.
  `updateNoteForUser` gained the optional `embeddings === null` path and the
  `expectedDescription` race guard in PR #69; both are orthogonal to the
  taxonomy column and should survive the edit untouched.
- **`sql/note/gets.ts`** — `selectNoteEmbeddingStateById` reads only the
  description and embedding state, so it needs no change.
- **`sql/note/parse.ts`** — `parseCategoryId` → `parseGroupId`.
- **`sql/category.ts`** — `ensureDefaultCategoryForUser` becomes
  `ensureDefaultTaxonomyChainForUser` in `sql/taxonomy.ts`, creating the whole
  epic → category → group chain when a user has none, and called from the
  `GET /api/taxonomy` service the same way (section 6.4).
- **`services/notes-app.ts`** — `createLabeledEntityForNotesApp` and
  `updateLabeledEntityForNotesApp` already take a `tableName` and an embedding
  column name; they collapse to a single taxonomy path with a `level` argument.
  `createTagLabelEmbedding` is already generic over labels and needs only a
  rename (`createLabelEmbedding`) to stop reading as tag-specific.
  `maintainNoteEmbeddingsForNotesApp` walks taxonomy rows once instead of
  categories and tags separately.
- **`ensureFallbackCategoryId`** becomes a per-level fallback resolver. With the
  phase-1 backfill guaranteeing a full chain per user, it can stop throwing.
- **New: `sql/taxonomy-level.ts`** — `listTaxonomyLevelsForUser`,
  `updateTaxonomyLevelLabelForUser(level, label)`, and
  `ensureTaxonomyLevelsForUser(client, userId)`. The last one is the analogue of
  the existing `ensureDefaultTagForUser`: call it from user creation and,
  defensively, from the taxonomy list path, so a user can never be left without
  a vocabulary. Renaming must map the unique-violation on
  `user_id_label_lower_idx` to a 409, not a 500.

## 4.4 Open product decisions

These are behavior choices, not technical blockers, and each one changes the
API surface:

1. **Deleting a non-empty node.** Today a category delete either reassigns notes
   to the fallback category or deletes them (`/api/categories/with-notes`). With
   three levels there are more options: reassign children to a sibling, promote
   children to the grandparent, or cascade the delete. Recommendation: require
   an explicit `mode` on `DELETE /api/taxonomy` — `"reassign-children"` |
   `"delete-subtree"` — and keep `ON DELETE RESTRICT` so an unspecified request
   fails loudly rather than silently orphaning data.
2. **Can a level be skipped in the UI?** The schema requires a full chain. If a
   user should be able to file a note without naming a group, the app must
   auto-create (or reuse) a default group. Recommendation: auto-create a default
   group on demand, so the DB invariant holds without forcing three naming
   decisions per note.
3. **Is `lastUsedAt` rolled up too?** Recommendation: yes — `MAX` over the
   subtree, matching `noteCount`, so tree ordering is consistent at every level.
4. **Are item labels still globally lowercased?** Recommendation: keep it. It is
   already enforced by `CHECK` at every level and is what makes the upsert-by-
   label pattern deterministic. Tier labels are the exception and preserve case —
   see section 2.3.
5. **Moving a subtree.** Re-parenting a category moves all its groups and notes
   implicitly, since children reference the parent by id. No cascade logic is
   needed — but the sibling-label unique constraint can reject a move into a
   parent that already has that label, and the API must surface that as a
   conflict rather than a 500.
6. **Does an anonymous visitor's tier rename survive a merge?** **Decided: no.**
   Strategy `drop`; merge final state by label with no rename tracking. Full
   reasoning and its consequence for renamed categories in section 3.4.
7. **Singular vs plural tier names.** **Decided: singular only.** The table
   stores exactly one word per tier and the UI uses it verbatim everywhere. No
   pluralization at the display layer and no `label_plural` column — do not
   guess a plural form. A sidebar heading therefore reads `Category`, not
   `Categories`. If that reads badly enough to matter, adding `label_plural`
   later is additive and cheap; until then, "no guessing" is the rule.
8. **Are tier names per user, or per user _and_ content type?** Today one user
   has exactly one vocabulary. If notes and tasks should eventually have
   _different_ tier names, this table needs a content-type dimension and the
   whole hierarchy needs to be scoped by it. That is a much larger change and is
   deliberately out of scope; the current shape does not block it, because
   `(user_id, level)` can gain a third key column additively.

---

# Part 5 — Semantic search simplification

## 5.1 What changes

`searchNotesByEmbedding` drops the composite score, the
`user_note_category_v1` join and the correlated tag `AVG` subquery, and scores
notes on the description vector alone:

```sql
SELECT <noteColumns>,
       1 - (n.description_embedding <=> $2::vector) AS similarity
FROM public.user_note_v1 n
JOIN public.user_taxonomy_v1 g ON g.id = n.group_id
JOIN public.user_taxonomy_v1 c ON c.id = g.parent_id
JOIN public.user_taxonomy_v1 e ON e.id = c.parent_id
WHERE n.user_id = $1
  AND n.description_embedding IS NOT NULL
ORDER BY similarity DESC, n.time_modified DESC
LIMIT $3
```

Also removed: `tagSimilarity` / `descriptionSimilarity` from
`SemanticSearchResult`, the `0.67 / 0.33` formula in
`app/api/embeddings/debug/route.ts`, and the tag inputs on `/embeddings`.

Note the added `AND n.description_embedding IS NOT NULL`. Today every note is
returned, with un-embedded ones scoring 0 and trailing the list. Once the score
_is_ the description similarity, a note with no embedding has no meaningful
score at all, so excluding it is both cheaper and more honest. This is a visible
behavior change: searches will no longer pad results with unrelated notes.

Taxonomy embeddings are **not** removed — they move to
`user_taxonomy_v1.label_embedding` and serve autocomplete (section 5.3).

## 5.2 A measured trap: do not switch to an index-ordered HNSW scan

The obvious follow-on to "score by one vector" is to `ORDER BY embedding <=>
query` so the HNSW index does the work. **Do not.** In a multi-tenant table that
form is silently and intermittently wrong.

Why: HNSW walks the graph for the globally nearest vectors and the `user_id`
predicate is applied _afterwards_, as a filter on the rows the index hands back.
If a user owns a small share of the table, every candidate can be filtered out
and the query returns fewer rows than exist — or none.

Measured on the prototype: 20,030 notes across three users (17,143 / 2,857 / 30),
real 1024-dim vectors, tag links on a third of the notes, `LIMIT 20`.

| Query shape                                             | Plan                                           | Big tenant (17,143 notes) | Tiny tenant (30 notes) |
| ------------------------------------------------------- | ---------------------------------------------- | ------------------------- | ---------------------- |
| Current composite (`0.67` desc + `0.33` tag)            | seq scan + per-note tag subplan (17,143 loops) | 20 rows, **256 ms**       | correct                |
| Index-ordered `<=>`, `user_id` **bound as a parameter** | HNSW index scan                                | 20 rows, 0.17 ms          | **0 rows**, 0.38 ms    |
| Exact per-user scan, description only                   | bitmap/seq scan + top-N heapsort               | 20 rows, **58–72 ms**     | 20 rows, 0.17 ms       |

The middle row is the important one: the **same prepared statement** returns a
full page for the big tenant and **nothing at all** for the small one, with the
plan reporting `Rows Removed by Filter: 391`. The tiny tenant's search box just
looks empty.

It is worth being precise about when this fires, because it is not
unconditional. With the user id written as a **literal**, the planner sees the
exact selectivity, skips the HNSW index, and the answer is right. The failure
appears whenever the planner cannot see that selectivity:

- `user_id` supplied as a bind parameter under a **generic plan** — the state a
  named prepared statement reaches after five executions. This is the case
  measured above.
- the user id arriving as a scalar subquery (also reproduced: 0 rows).
- stale statistics after a burst of inserts.

That conditionality makes it worse, not better: the query would pass review, pass
a manual test as the developer's own well-populated account, and then fail for
exactly the newest and smallest accounts. pgvector's mitigation
(`hnsw.iterative_scan = relaxed_order`, `hnsw.max_scan_tuples = 20000`) widened
the scan to 1,805 candidates and **still returned 0 rows**.

So: the exact per-user scan. Its plan does not depend on statistics, it is
correct at every tenant size, and it is still a solid win — roughly **3.5–4x
faster** than today (256 ms → ~60 ms on a 17,143-note user) purely from deleting
the per-note tag subquery. Realistic per-user note counts are in the hundreds,
where it runs in well under a millisecond.

Two consequences worth acting on:

- **`user_note_v1_description_embedding_hnsw_idx` is dead weight** — 139 MB for
  20,000 notes in the prototype, and unusable for per-user filtered search under
  either query shape (the current composite score can't use it either, because
  the ordering expression isn't the bare distance operator). Consider dropping
  it in phase 2 and documenting that per-user vector search is exact by design.
  Keep it only if global cross-user search is on the roadmap.
- If one user's notes ever reach the tens of thousands, the fix is partitioning
  or a per-tenant index strategy — not the naive index-ordered query, which
  fails worst exactly when the tenant is smallest.

## 5.3 Level-scoped label autocomplete

New: `POST /api/taxonomy/suggest` with `{ level, parentId?, query, limit }`.

The requirement is that every level carries an embedding so names can be
autocompleted. Embeddings alone are a poor fit for prefix typing — after two
keystrokes `"wo"` has little semantic content — so the recommendation is hybrid,
in one round trip:

1. Literal matches first: `label LIKE query || '%'`, then `label ILIKE '%' || query || '%'`.
2. Semantic matches after, from `label_embedding` cosine similarity against the
   query embedded with `task: "retrieval.query"`, above a similarity floor.
3. De-duplicate, cap at `limit`.

Scope every query by `user_id` and `level`, and by `parent_id` when the caller
already picked a parent. Section 2.4's measurement applies here too: at
realistic taxonomy sizes this is a sub-millisecond sequential scan, so the
embedding step's cost is the Jina round trip, not the SQL. Debounce it in the
client and skip it for queries under ~3 characters.

## 5.4 Embedding write paths

- Embed-on-write on taxonomy create and rename, at all three levels (reuse the
  existing create/update label paths).
- `maintainNoteEmbeddingsForNotesApp` walks `user_taxonomy_v1` for
  `missing` / `stale` instead of categories and tags separately.
  `EmbeddingMaintenanceResponse` needs a field shape covering three levels
  (for example replace `categoriesUpdated` with `taxonomyUpdated`, or report
  per-level counts).
- **Fix the existing gap**: `scripts/regenerate-embeddings.mjs` embeds tags and
  notes but never categories. Extend it to all taxonomy levels so the CLI and
  the maintenance endpoint agree.
- The post-merge best-effort backfill in `mergeAnonymousNotesAppSession` keeps
  working unchanged, and is still needed because the merge SQL inserts taxonomy
  rows directly.

---

# Part 6 — The hierarchy and the open-note ring

The database design in Part 2 is unaffected by PR #69 — the schema, the
migration and the search rewrite all stand as validated. What the ring changes
is the **client contract for a note's taxonomy field**, and it changes it in a
way that makes the hierarchy _easier_ to land, provided one decision is made
correctly. This Part is the decision and its consequences.

## 6.1 The form holds one id, and it is the leaf

`NoteFormState` gains exactly one field change:

```diff
 export interface NoteFormState {
-  selectedCategoryId: number | null
+  selectedGroupId: number | null
   selectedTagIds: number[]
   description: string
   timeDue: string | null
   timeRemind: string | null
   dueExpanded: boolean
   remindExpanded: boolean
 }
```

No `selectedEpicId`, no `selectedCategoryId` alongside it. The epic and category
are **derived** by walking up from the group in the taxonomy tree, never stored
on the entry and never sent to the server.

This is not a stylistic preference; four separate properties of the ring depend
on it.

**The dirty check stays honest.** `serializeNoteDraft` is the signature that
decides whether an entry autosaves. Every field in the form is in the signature.
If the picker's in-progress epic and category selections lived in the form, then
merely _browsing_ the picker would change the signature, mark the entry dirty,
and fire a background save of a note the user only looked at. Keeping the form
to the one persisted field means the signature keeps meaning "what would be
written".

The converse is the failure to avoid, and it was measured against the shipped
`serializeNoteDraft`:

```
-> shipped signature changes on a category move: dirty detected
-> signature omitting it: identical, so the move never autosaves
```

Autosave skips clean entries silently, so dropping the taxonomy id from the
signature produces a move that appears to work, survives a reload from
`localStorage`, and never reaches Postgres.

**A taxonomy move costs zero note writes.** Because a note references only its
group, re-parenting a group from one category to another is a single
`user_taxonomy_v1` row update. Every open entry's breadcrumb re-renders from the
tree on the next paint, and not one of the N notes in the ring becomes dirty. If
ancestors were denormalized onto the note — or onto the form — a move would have
to rewrite every affected note, and each rewrite would race the background saves
already in flight for those same notes. **This is the strongest argument against
denormalizing `epic_id` / `category_id` onto `user_note_v1`,** and it is worth
recording because that denormalization is otherwise tempting for query
convenience. Section 2.4's fixed-depth joins already make it unnecessary.

**The persisted snapshot stays small and stable.** `PersistedEntry.form` goes to
`localStorage` on a 1-second debounce while the user types. One integer per
entry is the whole taxonomy footprint.

**Reconciliation has one reference to repair, not three.** Section 6.3.

`NoteRecord` still carries `group`, `category` and `epic` refs for display
(section 4.1) — those are server-computed on read and are what
`noteToFormState` and the sidebar render from. The distinction is between the
**writable** field (one group id) and the **readable** projection (the resolved
path).

Consequences elsewhere, all mechanical:

| Site                                     | Change                                                           |
| ---------------------------------------- | ---------------------------------------------------------------- |
| `types/notes.ts` `createDefaultNoteForm` | `selectedGroupId: null`                                          |
| `types/notes.ts` `noteToFormState`       | `selectedGroupId: note.group.id`                                 |
| `lib/noteDraft.ts` `serializeNoteDraft`  | `groupId: form.selectedGroupId`                                  |
| `lib/noteDraft.ts` `noteRequestBody`     | `groupId: form.selectedGroupId`                                  |
| `lib/noteDraft.ts` `isSaveableForm`      | `form.selectedGroupId !== null`                                  |
| `stores/openNotes.ts` `isEmptyDraft`     | unchanged — it does not look at the category                     |
| `stores/openNotes.ts` `openExistingNote` | `categoryInputValue: note.group.label`                           |
| `stores/openNotes.ts` `openNewDraft`     | `options.categoryId` → `groupId`, `categoryLabel` → `groupLabel` |

## 6.2 Where the picker's in-progress state lives

The three-step Epic → Category → Group picker needs somewhere to hold "the user
has chosen an epic and is now choosing a category". That state is per-entry — two
open notes can each be mid-selection — but it is **not** part of the form.

Put it on `OpenNoteEntry` beside the fields that already work this way.
`categoryInputValue` and `pendingTagLabels` are the existing precedent: per-entry,
persisted, and deliberately outside `form` so they never reach the signature.

```diff
 export interface OpenNoteEntry {
   key: OpenNoteKey
   noteId: NoteRef | null
   baseTimeModified: string | null
   form: NoteFormState
   savedSignature: string | null
   saveStatus: NoteSaveStatus
   editorSessionId: number
-  categoryInputValue: string
+  /** Free text in the group picker's filter box. */
+  groupInputValue: string
+  /** Picker navigation only. Never part of the signature. */
+  pickerEpicId: number | null
+  pickerCategoryId: number | null
   pendingTagLabels: string[]
   …
 }
```

On open, seed `pickerEpicId` / `pickerCategoryId` from the group's ancestors so
reopening a note shows the picker already positioned.

## 6.3 Reconciliation, and the localStorage version trap

`reconcileOpenNotes` repairs references that died while the tab was closed. Its
current options are `categoryExists`, `tagExists`, `fallbackCategoryId`; they
become `groupExists`, `tagExists`, `fallbackGroupId`. The repair branch already
recomputes `savedSignature` for clean entries, which is the behavior to
preserve verbatim.

One thing genuinely gets simpler: a dead group is the **only** taxonomy failure
a persisted draft can have. A deleted epic or category cannot leave a dangling
half-reference, because the entry never stored one.

**The trap.** `isSnapshot` rejects anything whose `schemaVersion !== 1`:

```ts
const isSnapshot = (value: unknown): value is OpenNotesSnapshot => {
  if (!isObject(value)) return false
  if (value.schemaVersion !== 1) return false
  …
}
```

`readOpenNotesSnapshot` returns `null` on rejection, and `rehydrateOpenNotes`
treats `null` as "nothing to restore". So **bumping the version to 2 silently
discards every unsaved draft in every user's browser** on the first load after
deploy. Nothing errors; the notes are simply gone. This is precisely the loss
the storage module was separated from `notesCache` to prevent.

Verified against the shipped module rather than assumed — a snapshot holding
`"unsaved text"`, rewritten with `schemaVersion: 2` and read back:

```
-> v2 snapshot read back as: null (unsaved text discarded, no error)
-> same payload at v1 restores: unsaved text
```

The same probe confirms the signature half of the problem, which is why step 3
below is not optional:

```
-> v1: {"noteId":1,"categoryId":7,"tagIds":[],"description":"hello", ...}
-> v2: {"noteId":1,"groupId":42,"tagIds":[],"description":"hello", ...}
-> carrying a v1 savedSignature into v2 marks every restored note dirty
```

The plan is therefore to **upgrade, not reject**:

1. Accept `schemaVersion` 1 or 2 in `isSnapshot`.
2. When reading a v1 snapshot, map each entry's `form.selectedCategoryId` to
   that category's default group. The phase-1 migration creates exactly one
   `uncategorized` group under every category, so the mapping is total and
   deterministic — this is a second reason the migration seeds a group per
   category rather than only where notes exist.
3. Recompute `savedSignature` for entries that were clean, per the invariant.
   A v1 signature has `categoryId` in it and will never match a v2 signature, so
   skipping this marks every restored note dirty and fires a save storm on load.
4. Write back as v2.

Give the upgrade its own unit test in `test/open-notes-storage.test.ts`, which
already covers the analogous cases. `reconcileOpenNotes` is pure and takes
lookups, so this is testable without a DOM.

## 6.4 The silent-no-save trap, three levels deep

`isSaveableForm` returning false makes autosave skip an entry **without any
user-visible signal**. `AGENTS.md` records what that cost last time: a whole
manual test campaign, demos included, against an empty `user_note_v1`, because
new accounts had no category.

A three-level chain has more ways to produce no valid group, so the plan carries
three defenses:

1. **The migration seeds the full chain** for every user, not only users with
   categories (section 3.1, steps 2–6). This is the primary fix.
2. **A lazy repair on the read path**, mirroring the shipped
   `ensureDefaultCategoryForUser`: `ensureDefaultTaxonomyChainForUser` at the top
   of the `GET /api/taxonomy` handler, creating the epic → category → group chain
   only when the user has none. This is what catches a user-creation path that
   forgot to seed, which is otherwise invisible until someone's notes quietly
   stop saving.
3. **Make the skip visible.** Autosave should not silently do nothing. The
   detached path already surfaces this — "A note was closed before it could be
   saved because it has no category." — but an entry sitting in the ring dirty
   and unsaveable shows nothing. Recommendation: give `NoteSaveStatus` a
   `blocked` state, surfaced on the save indicator and the recent-notes row, so
   "this note cannot save yet" is distinguishable from "saved".

Point 3 is a small addition beyond the taxonomy work proper, but this is the
change that triples the number of ways to enter the state, and the failure is
silent data loss that a reload does not reveal.

## 6.5 Taxonomy edits versus in-flight saves

Deleting or moving taxonomy while N notes are open and saving is the genuinely
new concurrency surface. Three cases:

**Move (re-parent a group or category).** Safe by construction — section 6.1. No
note row changes, no entry becomes dirty, no in-flight save carries anything
stale. The only visible effect is breadcrumbs re-rendering.

**Delete a node whose subtree holds open notes.** Today
`remapEntriesAfterCategoryChange` walks every ring entry, repoints dead category
ids at the fallback, and recomputes `savedSignature` for clean entries. It
becomes `remapEntriesAfterTaxonomyChange` and must additionally resolve deaths
caused by an _ancestor_ going away, since deleting a category takes its groups
with it under the chosen disposition (decision 4.4-1).

**It must also remap `detachedSavesRef`, which it does not do today.**
`remapEntriesAfterCategoryChange` uses `patchEveryEntry`, which only touches the
ring. A detached save is a snapshot of an evicted-but-dirty entry with a request
still to fire; if its group was just deleted, that request lands as a 400 for a
note the user cannot see. The window is narrow and it exists today with flat
categories, but `ON DELETE RESTRICT` plus three levels widens it. Closing it is
a few lines in the same handler and belongs in this work.

Ordering rule for the delete flow: **remap the ring and the detached map first,
then issue the delete.** The reverse order guarantees a spray of background save
errors.

**Concurrent last-write-wins across N writers** is unchanged in kind but larger
in degree. `baseTimeModified` is already recorded on every entry and still unused;
the plan does not propose using it, but the field is there when conflict
detection is wanted, and the taxonomy work does not make the situation worse
because it does not add any new client-writable taxonomy field to the note.

## 6.6 Gaps found reviewing the ring against the hierarchy

Five things that a straightforward implementation gets wrong. Two are bugs that
exist in shipped code today and that the hierarchy widens; three are choices the
plan previously left underspecified. Each was checked against the code or the
database rather than reasoned about.

### 6.6a A sidebar move silently discards unsaved text

**This is live data loss today, not a hypothetical.** `patchNoteFromSidebar`
builds its payload from the `NoteRecord` in the `notes` array — server state —
not from the open entry's live draft:

```ts
body: JSON.stringify({
  userId: user.id,
  noteId: note.id,
  note: {
    categoryId: nextCategoryId,
    tagIds: nextTagIds,
    description: note.description ?? "",   // ← last-saved text, not the draft
    …
```

and `applyServerNoteToEntry` then overwrites the entry's whole form with the
response and recomputes `savedSignature`:

```ts
const form = noteToFormState(note)
patchEntry(entry.key, {
  form,
  baseTimeModified: note.timeModified,
  savedSignature: serializeNoteDraft(note.id, form),
  …
```

So: type into an open note, and within the 3-second autosave debounce move that
same note from the sidebar. The PATCH carries the _old_ description, the
response carries the old description, the entry adopts it, and the signature is
recomputed so the entry reads **clean**. The typing is gone from the screen and
was never sent. Outside the debounce window the autosave has already landed and
the move is harmless, which is why this survived review — it is a race the ring
created and only reproduces inside a 3-second window.

The existing code already knows the two writes can race; `patchNoteFromSidebar`
registers on `saveInFlightRef` under the entry's key with a comment about
ordering. Ordering was necessary but not sufficient: the payload itself is
stale.

**Fix, and it simplifies things.** When the note is open in the ring, a sidebar
move should not issue its own PATCH at all. It should patch `selectedGroupId` on
the entry — a normal draft edit — and let the existing autosave carry it with
the live text. Only when the note is _not_ open does the direct PATCH path
apply. That removes the stale-payload class of bug entirely, removes the need to
register on `saveInFlightRef` for this case, and means one code path writes a
note instead of two.

This must be fixed as part of the hierarchy work rather than after it, because
the hierarchy multiplies sidebar move affordances: moving between groups, and
re-parenting a group or a category.

### 6.6b The anonymous merge loses taxonomy placement for dirty entries

`readOpenNotesSnapshotForAnyUser` re-keys the snapshot to the new user id and
lets reconciliation repair references, with this reasoning in the code:

> Note rows are reparented and keep their ids, but categories and tags are
> dedup-remapped, so re-key the snapshot and let reconciliation repair the
> references. `handleLogin` already flushed everything, so nothing here is
> unsaved.

The flush makes entries clean, and clean entries adopt the server record, so the
remap is invisible. But a flush is best-effort: `flushAllPendingSaves` collects
results and a save can fail (offline, 5xx), leaving an entry dirty. A dirty
entry keeps its local draft, whose group id belongs to the anonymous user's now
deleted taxonomy row, so `groupExists` is false and reconciliation sends it to
the **fallback group** — the note's placement is silently lost, and with three
levels that is a whole path rather than one category.

Fix: have the merge return the id remap it already computes in memory
(`categoryRemap` / `tagRemap` today, three taxonomy levels after this change),
and apply it to ring entries **and** `detachedSavesRef` before reconciliation,
recomputing `savedSignature` for entries that were clean. Returning the map is
nearly free — the merge builds it anyway — and it turns a silent relocation into
an exact one.

### 6.6c The label-upsert race, reproduced

`resolveCategoryIdForUser` / `resolveTagIdForUser` use this shape:

```sql
WITH inserted AS (
  INSERT INTO … VALUES ($1, $2) ON CONFLICT (user_id, label) DO NOTHING
  RETURNING id
)
SELECT id FROM inserted
UNION ALL
SELECT id FROM … WHERE user_id = $1 AND label = $2
LIMIT 1
```

with `if (!rows[0]) throw new Error("Failed to resolve note category.")`.

Under a concurrent insert of the same label that has not yet committed, the
`DO NOTHING` skips and the `SELECT` — running on the statement's snapshot —
cannot see the uncommitted row, so the statement returns **zero rows** and the
service throws. Reproduced on PostgreSQL 17.11 against the plan's schema:

```
--- session B runs the shipped resolve pattern while A is uncommitted ---
 id
----
(0 rows)
    ^ zero rows here means the service throws 'Failed to resolve'

--- the DO UPDATE variant, same contention ---
 id
----
 13
```

The ring makes this materially more reachable: N notes are open, each can create
a group, and creating the same group name from two of them at once is an obvious
user action. Fix is one line — `ON CONFLICT … DO UPDATE SET label = EXCLUDED.label
RETURNING id`, which takes the row lock, waits, and always returns an id.
Carry the same fix to tags while touching this code.

### 6.6d Roll-up counts: fixed-depth aggregates, not a recursive CTE

Section 2.6 demonstrated subtree counts with a recursive CTE. That was the right
tool for proving correctness at arbitrary depth, but the depth is fixed at three
and `GET /api/taxonomy` is now refetched on a coalesced 4-second debounce while
notes autosave in the background, so this query runs often.

Measured on one user with 1 epic, 23 categories, 463 groups and 20,005 notes,
three runs each:

| Roll-up shape                                   | Execution time |
| ----------------------------------------------- | -------------- |
| Recursive CTE over `parent_id`                  | 26–31 ms       |
| Fixed-depth aggregate (group → category → epic) | 5.5 ms         |

Roughly 5x, and the two agree on every row (`rows_where_they_disagree = 0`, and
the epic roll-up equals the total note count). Use the fixed-depth form in
`listTaxonomyByUser`. Keep the recursive version in the test suite as the
independent oracle the fixed-depth one is checked against — that is what proved
them equal here.

### 6.6e Creating a whole path should be one request

The picker lets a user name a new epic, a new category and a new group in one
gesture. Doing that as three sequential `POST /api/taxonomy` calls has two
problems: three round trips inside a save, and a failure after the first leaves
a stray epic with no children. Nothing is corrupted — the constraints hold — but
it is untidy and user-visible.

Add `POST /api/taxonomy/path` taking `{ epicLabel, categoryLabel, groupLabel }`
(any prefix may be existing ids instead) and resolving the chain in one
transaction, returning the group id. It reuses `resolveTaxonomyIdForUser` per
level with the 6.6c fix, and gives the client a single call to await before a
save.

### 6.6f Why the `notesCache` key bump is load-bearing

Section 7.1 says to bump the `notes-app-cache-v1` key. That is not only hygiene.
`rehydrateOpenNotes` runs twice — once against the cached paint, once against
the fresh fetch with `force: true` — and it passes whatever taxonomy it has into
`reconcileOpenNotes`. If a stale v1 cache were readable, the first pass would run
with **no** taxonomy, every entry's group would fail `groupExists`, and clean
entries would be rewritten to the fallback with a recomputed signature before the
second pass could correct them. Bumping the key means there is no cache to paint
from on the first load after deploy, so the cold path runs a single reconcile
against real data. Bump it in the same commit as the storage upgrade.

## 6.7 What does not change

Worth stating so the implementer does not go looking:

- **The ring reducers** (`openExistingNote`, `activate`, `evictToCap`, `goBack`,
  `closeEntry`) are taxonomy-agnostic apart from the two `openNewDraft` option
  names in 6.1. The insert → activate → evict ordering and the `cap === 1` test
  are untouched.
- **The save engine** — debounce, per-key queueing, detached mode, keepalive
  exit — needs no structural change. Payload shape changes; control flow does
  not.
- **The embedding-skip fast path** already makes taxonomy-only saves free of
  Jina calls, which is most of what the ring generates. It compares descriptions
  only, so it needs no taxonomy awareness.
- **Search** (Part 5) is untouched by the ring. Results are keyed by note id and
  `mergeSavedNote` patches them in place from the server record.

# Part 7 — Client changes

## 7.1 `apps/notes-next`

The current UI encodes "flat categories + flat tags" everywhere. Highest-impact
files, updated for the post-#69 architecture:

- **`src/types/notes.ts`** — `NoteFormState.selectedCategoryId` →
  `selectedGroupId`; `createDefaultNoteForm`; `noteToFormState` reads
  `note.group.id`. Per section 6.1 this is the _only_ form field that changes.
- **`src/lib/noteDraft.ts`** — `serializeNoteDraft`, `noteRequestBody` and
  `isSaveableForm` all move from `categoryId` to `groupId`. Getting
  `serializeNoteDraft` wrong is the highest-consequence mistake in the whole
  client change: omit the field and moving a note between groups never
  autosaves, with no error.
- **`src/stores/openNotes.ts`** — only `openExistingNote`
  (`categoryInputValue: note.group.label`) and the `openNewDraft` option names.
  The reducers are otherwise taxonomy-agnostic. Add the picker-navigation
  fields from section 6.2.
- **`src/lib/openNotesStorage.ts`** — the v1 → v2 snapshot upgrade of section
  6.3, and `categoryExists` / `fallbackCategoryId` → `groupExists` /
  `fallbackGroupId`. Do not simply bump the version.
- **`src/components/notes/NotesApp.tsx`** — the orchestrator. Loads
  `categories`/`tags`/`notes` into React state (not Zustand) and owns every CRUD
  call. Needs: a taxonomy fetch replacing `loadCategories`, tree-shaped
  grouping in `categoryNoteGroups`, hierarchical id-based URL state
  (`?epic=&category=&group=`), `groupId` in `saveEntry`'s payload,
  `remapEntriesAfterCategoryChange` → `remapEntriesAfterTaxonomyChange`
  including the detached map (section 6.5), `getDefaultCategoryId` → a
  chain-aware default resolver, and `applyServerNoteToEntry` reading the new
  refs. The delete-category-with-notes flow at the bottom of the file filters
  `notesRef.current` by `note.category.id` and must become subtree-aware.
- **`src/components/notes/ResultsColumn.tsx`** — today two flat accordions
  (Categories, Tags) plus a search-results section, with per-note "Move" and
  per-category edit/delete actions. Becomes an expand/collapse tree with
  per-level actions; roll-up counts come from `TaxonomyRecord.noteCount`. It
  already receives `openNoteIds` and `activeNoteId` to mark open entries — that
  keeps working unchanged, but the tree must not collapse or re-order as
  background saves land, or the sidebar will jump under the user while several
  notes autosave.
- **`src/components/notes/NoteForm.tsx`** — the single category combobox becomes
  a three-step Epic → Category → Group picker where each step scopes the next.
  Per decision 4.4-2, the group step should be able to auto-create a default.
  The form has no submit control and must not gain one.
- **`src/components/notes/NotesHeader.tsx`** — recent-notes rows currently show
  `categoryLabelById(entry.form.selectedCategoryId)` on the same line as the
  headline. **Decided:** show the full breadcrumb, `Epic → Category → Group`, on
  a **second line** beneath the headline, because the path is too long to share
  a row with a save-status dot and a close control. Notes for the implementer:
  - Resolve the path by walking up from `entry.form.selectedGroupId`; do not
    store it on the entry. A `useMemo` over the taxonomy tree keyed by the tree
    and the group id gives every row its path in one pass. It must not be a
    store selector that builds an object — that hangs the app (see the store
    selector note below).
  - Truncate per segment with `text-overflow: ellipsis` rather than truncating
    the whole string, so the group — the most specific and most useful segment —
    survives. Put the untruncated path in the row's `title`.
  - A never-saved draft with no group yet has no path. Render nothing rather
    than a placeholder arrow chain.
  - The row is a button; the second line must not be separately focusable.
- **`src/components/ui/FilterablePickerPopup.tsx`** — generic filter/select/
  create popup, already used for both categories and tags. Extend it with an
  async suggestion source so it can call `/api/taxonomy/suggest`.
- **`src/stores/notesAppStore.ts`** — `manuallyExpandedCategoryId: number | null`
  becomes a set of expanded node ids. Note the store now spreads `OpenNotesState`
  into its own state, and **selectors must return an existing reference or a
  primitive** — a tier-label or breadcrumb selector that builds a new object per
  call will hang the app in an infinite `useSyncExternalStore` loop. Derive
  those with `useMemo` in the component.
- **`src/lib/notesCache.ts`** — `NotesCacheSnapshot` swaps `categories` for
  `taxonomy` and gains `taxonomyLevels`. Bump the cache key so stale snapshots
  are discarded rather than mis-parsed. This one _is_ safe to discard on version
  change — unlike `notes-open-notes-v1`, it holds only server data.
- **`src/components/notes/modals/*`** — the four category/tag modals become
  level-aware; the delete modal needs the 4.4-1 disposition options. A new modal
  or settings panel is needed for renaming the four tier names.
- **`src/components/notes/NoteResultsList.tsx`** — the similarity badge still
  reads `similarity`; only the removed sibling fields matter.
- **`app/embeddings/page.tsx`** — drop the tag inputs and the composite score
  readout; optionally add a taxonomy-autocomplete probe.
- **`src/hooks/useOpenNotesAutosave.ts`** — no change unless `NoteSaveStatus`
  gains the `blocked` state from section 6.4.

Tests, which are now a real safety net rather than an afterthought:

- **`test/open-notes-storage.test.ts`** — add the v1 → v2 upgrade cases from
  section 6.3: a v1 snapshot with a clean entry restores clean under v2, a v1
  dirty entry keeps its text, and a v1 entry whose category is gone lands on the
  fallback group. The existing "no unedited entry loads dirty" invariant test is
  the one that would have caught the signature mistake; keep it and make sure it
  runs against v2.
- **`test/open-notes.test.ts`** — the ring tests barely touch the category, so
  most need only the renamed `openNewDraft` options. The `cap === 1` ordering
  test must not be disturbed.
- **`test/notes-api-adapter.test.ts`** and
  **`lib/db-notes/testing/notes-api-adapter-suite.ts`** — the shared suite is
  where category CRUD, note CRUD, search and embedding maintenance are asserted;
  it must be rewritten alongside the contract, and it is the cheapest place to
  pin the new hierarchy rules.
- **`lib/db-notes/testing/note-embedding-skip.test.ts`** — already pins
  "category-only change reuses the embedding". Rename to the group equivalent
  and keep it; it is the test that proves a taxonomy move costs no Jina call.
- **`lib/db-notes/testing/default-category.test.ts`** — becomes the
  default-chain test for `ensureDefaultTaxonomyChainForUser` (section 6.4):
  a new user gets a full epic → category → group chain on first taxonomy list,
  it is idempotent on a second call, and a user with existing taxonomy is
  untouched.

Per `apps/notes-next/AGENTS.md`, check that each new test fails without its fix —
two tests in PR #69 initially passed either way, and the `cap === 1` test exists
precisely because every larger cap hid the bug it guards.

Per repo convention, app-wide UI state belongs in the Zustand store rather than
being prop-drilled — the tree expansion state, the multi-step picker selection,
and the tier vocabulary all qualify. The vocabulary in particular should be a
store selector (something like `useTierLabel(level)`) rather than a prop threaded
through the tree, since nearly every component needs it.

### Hardcoded tier words that must become data

Making the four tier names user-editable means no user-facing string may name a
tier literally. Today they do, in roughly two dozen places across eight files —
counted with `rg` over JSX text, `aria-label`, `placeholder`, `title` and `alt`:

| File                                                  | `categor*` | `note*` | `tag*` |
| ----------------------------------------------------- | ---------- | ------- | ------ |
| `src/components/notes/ResultsColumn.tsx`              | 4          | 2       | 2      |
| `src/components/notes/NotesApp.tsx`                   | 4          | 1       | —      |
| `src/components/notes/NoteForm.tsx`                   | 1          | 3       | 1      |
| `src/components/notes/modals/EditCategoryModal.tsx`   | 2          | —       | —      |
| `src/components/notes/modals/DeleteCategoryModal.tsx` | 1          | —       | —      |
| `src/components/notes/modals/EditTagModal.tsx`        | —          | —       | 2      |
| `src/components/notes/NotesHeader.tsx`                | —          | 2       | —      |
| `app/embeddings/page.tsx`                             | —          | 1       | 3      |

Representative examples: `<div className={styles.accordionHeading}>Categories</div>`
and `aria-label="Notes by category"` in `ResultsColumn.tsx`. Note that
`.accordionHeading` applies `text-transform: uppercase` in CSS, so the sidebar
headings render fine whatever case the user types — but buttons and prose
elsewhere show the label as stored, which is why tier labels preserve case
(section 2.3).

The tag strings are listed for completeness but are **not** in scope: tags are
not a tier and keep their fixed name. Only the four tier words become data.

## 7.2 `apps/notes-android`

Gated by `apps/notes-android/tools/validate-notes-contract.mjs`, which checks
field _order_ and Kotlin types, so these edits are mandatory, not optional:

- `app/.../model/Models.kt` — replace `CategoryRecord`/`NoteCategoryRef` with
  `TaxonomyRecord`/`TaxonomyRef`; add `TaxonomyLevelRecord`; update `NoteRecord`,
  `NoteDraft` (`selectedCategoryId` → `selectedGroupId`),
  `SemanticSearchResult`, `AppSnapshot` (which must persist the tier vocabulary
  so the widget can label itself offline).
- `app/.../data/JsonCodec.kt` — decoders in matching field order.
- `app/.../data/NotesApiClient.kt` — `/api/taxonomy` calls; `groupId` in the
  note payload.
- `app/.../widget/NotesHomeWidget.kt` and `WidgetOverlayActivities.kt` — the
  Glance `widgetCategoryFilterKey` filter and the category picker overlay.
- `app/.../ui/CategoriesPopup.kt` — level-aware.
- Then `pnpm --filter notes-android contracts:check` and
  `pnpm run build:android:dist:dev`.

Note: `apps/notes-android/test/notes-api-adapter.test.ts` is already broken (it
imports a non-existent `../server/src/app`), so the Node contract validator is
the only real gate on the Android side.

---

# Part 8 — Rollout order

1. Land the phase-1 migration (both new tables, the vocabulary seed, the
   backfill), `verify-contract.mjs` additions, the two
   `MERGE_TABLE_STRATEGIES` entries and the rewritten merge SQL. Run
   `pnpm run db:migrate` then `pnpm run db:verify` on the branch — `db:verify`
   also regenerates and diffs `schema/current.sql`, `db-types.ts`,
   `db-schema.json` and `notes-app.json`, so commit those artifacts with the
   migration.
2. Land the contract change plus the `@lib/db-notes` SQL/service rewrite,
   including the simplified search. Update the shared adapter suite in the same
   commit — it is the contract's executable specification.
3. Land the `notes-next` draft layer **before** the UI: `NoteFormState`,
   `noteDraft.ts`, the `openNotes.ts` option renames, and the
   `openNotesStorage.ts` v1 → v2 upgrade, with their tests. This is the step
   where a mistake silently destroys user drafts, so it is worth landing and
   reviewing on its own rather than buried in a UI diff.

   The two live bugs in 6.6a and 6.6b can be fixed **independently of this plan
   and shipped first** — neither depends on the hierarchy, both discard user
   text today, and fixing 6.6a in particular removes a whole write path that
   would otherwise have to be ported to groups. Doing them first also means
   their fixes get reviewed on their own evidence rather than inside a large
   taxonomy diff.

4. Land the `notes-next` API routes, then the UI.
5. Land the Android contract updates; `contracts:check`; build the APK.
6. Deploy: `pnpm run release:notes:prepare`, run `db:migrate` against the target
   Notes DB, deploy `notes-next` on Railway.
7. Run embedding maintenance (`mode: "missing"`) or the extended
   `db:embeddings:regenerate` so the backfilled taxonomy rows get label vectors —
   the migration inserts them with `label_embedding` NULL and autocomplete stays
   empty until this runs.
8. Only then land phase 2 (drop `category_id` and `user_note_category_v1`, flip
   the verify assertions to must-be-absent, optionally drop the note HNSW
   index).

Local verification for each step, per repo conventions:

```bash
bash scripts/cloud-agent-postgres.sh start   # or: sudo pg_ctlcluster 17 main start
export PATH="/usr/lib/postgresql/17/bin:$PATH"
pnpm run db:migrate && pnpm run db:verify
pnpm --filter @lib/db-notes test          # set DB_NOTES_TEST_URL for the DB suite
pnpm --filter notes-next test             # ring, storage and exit suites
pnpm run verify                            # db contracts + notes-web + android
```

`DB_NOTES_TEST_URL` must point at a throwaway database — the merge suite
deliberately never connects to `DB_NOTES_URL`, which in cloud environments is
the real Notes database.

**Verify persistence at a layer the UI cannot fake.** `apps/notes-next/AGENTS.md`
is emphatic about this and it applies doubly here, because the ring will happily
render a full hierarchy from `localStorage` while nothing has reached Postgres.
Clear `localStorage`, reload, and check `user_note_v1.group_id` and
`user_taxonomy_v1` directly with `psql` — not the sidebar.

---

# Part 9 — Risks

| Risk                                                                                                                                                                                                                                          | Mitigation                                                                                                                                                                                    |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Silent search-recall regression if someone "optimizes" the simplified query onto the HNSW index — it passes review and passes a manual test on a well-populated account, then returns nothing for the smallest accounts                       | Documented in 5.2 with a reproduction; add an adapter-suite test that seeds one user with many notes and another with a handful and asserts _both_ get a full page of results                 |
| Backfill leaves notes without a group                                                                                                                                                                                                         | `SET NOT NULL` in the same migration fails the transaction; plus the 3.3 structural invariants in `db:verify`                                                                                 |
| `db:verify` fails after merge because `verify-contract.mjs` was not updated                                                                                                                                                                   | Called out as the known top cause; update it in the same commit as the migration                                                                                                              |
| Anonymous merge loses data on the three-level remap                                                                                                                                                                                           | Level-ordered remap (3.4), `FOR UPDATE` locks preserved, expanded DB-backed regression tests                                                                                                  |
| Released APK breaks when `/api/categories` disappears                                                                                                                                                                                         | Keep a read-only level-2 alias until the APK is rebuilt (4.2)                                                                                                                                 |
| Autocomplete returns nothing after rollout                                                                                                                                                                                                    | Embeddings are NULL until step 6 runs; the literal prefix half of the hybrid still works, which is why hybrid is recommended                                                                  |
| Phase 2 runs before the new code deploys                                                                                                                                                                                                      | Two separate migrations; phase 1 is additive and leaves the old table readable                                                                                                                |
| Code branches on a tier _label_ instead of `level`, so a rename breaks filtering, routing or cached state                                                                                                                                     | The guardrail in 2.3: ids and `level` in every URL, cache key and API filter; labels are render-time only                                                                                     |
| A new user is created without tier definitions, so their first taxonomy write fails the level FK                                                                                                                                              | `ensureTaxonomyLevelsForUser` on the user-creation path (4.3), plus the "every user has all four tier definitions" invariant in `db:verify` (3.3)                                             |
| A user renames a tier to a word the naive pluralizer mangles                                                                                                                                                                                  | Cosmetic only; additive `label_plural` column is the escape hatch (4.4-7)                                                                                                                     |
| **Bumping `notes-open-notes-v1` to v2 silently discards every unsaved draft in every browser** — `isSnapshot` rejects an unknown version and the caller reads `null` as "nothing to restore"                                                  | Upgrade the snapshot instead of rejecting it, mapping each v1 `categoryId` to that category's seeded group, and recompute `savedSignature`; unit-tested in `open-notes-storage.test.ts` (6.3) |
| A restored draft loads dirty because its v1 signature can never match a v2 signature, firing a save storm on first load after deploy                                                                                                          | The upgrade recomputes `savedSignature` for entries that were clean; the existing "no unedited entry loads dirty" test covers exactly this                                                    |
| `serializeNoteDraft` omits `groupId`, so moving a note between groups never autosaves and shows no error                                                                                                                                      | Called out in 6.1 and 7.1 as the highest-consequence line in the client change; add a test that a group change alone marks an entry dirty                                                     |
| Notes silently never save because no valid group exists — the failure that made a whole manual test campaign write to an empty table                                                                                                          | Three defenses in 6.4: migration seeds the chain, `ensureDefaultTaxonomyChainForUser` repairs lazily on read, and a `blocked` save status makes the skip visible                              |
| A taxonomy delete leaves a detached save pointing at a dead group, so a background request 400s for a note the user cannot see                                                                                                                | Remap the ring **and** `detachedSavesRef` before issuing the delete (6.5); this closes a gap that exists today                                                                                |
| **A sidebar move discards unsaved text** — the PATCH carries the last-saved description and the response overwrites the live draft and marks it clean. Live today inside the 3s autosave window, and the hierarchy adds more move affordances | When the note is open, make a sidebar move a draft edit on the entry and let autosave carry it, instead of a second write path with a stale payload (6.6a)                                    |
| An anonymous merge relocates a dirty open note to the fallback group, losing its whole path, when the pre-merge flush did not fully succeed                                                                                                   | Return the id remap the merge already computes and apply it to the ring and `detachedSavesRef` before reconciling, recomputing signatures (6.6b)                                              |
| Two open notes create the same group name at once and the resolve throws "Failed to resolve" — reproduced on PG 17.11, returns zero rows                                                                                                      | `ON CONFLICT … DO UPDATE SET label = EXCLUDED.label RETURNING id`, which always returns a row under contention; same fix for tags (6.6c)                                                      |
| The taxonomy refetch runs every few seconds while notes autosave, and a recursive-CTE roll-up makes it ~5x more expensive than it needs to be                                                                                                 | Fixed-depth aggregate roll-up, 5.5 ms vs 26–31 ms at 20k notes; keep the recursive form in tests as the oracle (6.6d)                                                                         |
| A partially created epic/category/group chain is left behind when the picker's second or third create call fails                                                                                                                              | One transactional `POST /api/taxonomy/path` that resolves the whole chain and returns the group id (6.6e)                                                                                     |

---

# Appendix — Verification transcript

Environment: PostgreSQL 17.11 + pgvector 0.8.6. Every run starts from a dropped
database and loads the real `lib/db-notes/schema/current.sql`, so they reproduce
from scratch.

Three transcripts were captured:

**`taxonomy_schema_verification.log`** — schema, constraints and migration.
Seeded with 2 users / 4 categories / 6 notes, deliberately including a
`NULL`-description note and an anonymous user.

- Phase-1 migration applied in a single transaction; all 6 seeded notes
  backfilled (`notes_without_group = 0`); the Epic > Category > Group > Note tree
  read back correctly through a three-level join.
- 15 integrity attempts behaved exactly as intended — 13 rejections, each by the
  specific constraint designed to catch it, and 2 positive cases accepted (same
  label under different parents; a valid note in its own user's group).
- Phase-2 cutover applied cleanly; the note→group composite FK then became the
  constraint rejecting wrong-level, cross-user and tampered writes.
- `pg_dump --schema-only` round-tripped the generated column, both composite FKs
  and `UNIQUE NULLS NOT DISTINCT` verbatim.
- Whole-tree read, ancestor-path join, recursive roll-up counts at all three
  levels, and "all notes under one epic" all returned correct results.
- Deleting a user left 0 orphaned taxonomy rows.

**`search_query_plan_comparison.log`** — the search rewrite. 20,030 notes with
real 1024-dim vectors across three tenants of 17,143 / 2,857 / 30 notes, tag
links on a third of the notes.

- Current composite shape: 20 rows in 256 ms, seq scan with the tag subplan
  running 17,143 times.
- Index-ordered HNSW with `user_id` bound as a parameter under
  `plan_cache_mode = force_generic_plan`: the same prepared statement returned 20
  rows for the 17,143-note tenant and **0 rows** for the 30-note tenant
  (`Rows Removed by Filter: 391`). Still 0 with
  `hnsw.iterative_scan = relaxed_order` and `hnsw.max_scan_tuples = 20000`.
- Recommended exact per-user scan under the _same_ generic plan: 20 rows for
  both tenants — 0.17 ms for the small one, 49–72 ms for the 17,143-note one.
- `user_note_v1_description_embedding_hnsw_idx` measured 139 MB.

**`taxonomy_level_vocabulary_verification.log`** — the per-user renameable tier
vocabulary, on the same seeded data.

- Both new tables plus the vocabulary seed, the `uncategorized` backfill, and the
  note→group move applied in a single transaction. All 6 notes backfilled; every
  auto-created item label is `uncategorized` at all three levels, including for
  the user who already owned a category named `uncategorized`.
- 11 vocabulary cases behaved as intended: 7 rejections (row at an unnamed tier,
  deleting an in-use tier definition, tier outside 1..4, duplicate
  `(user_id, level)`, case-insensitively duplicate tier name, blank tier name,
  row for a user with no vocabulary at all) and 4 positive cases — renaming
  levels 1 and 4 with the taxonomy row count unchanged at 10, two users holding
  independent vocabularies, the same data rendering under each owner's words, and
  a user delete leaving 0 orphans in both tables.
- The six-way `ON DELETE` matrix (`NO ACTION` / `RESTRICT` / `CASCADE` × both
  table-creation orders) all cascaded cleanly with 0 orphans, which is what
  allowed `RESTRICT` to be chosen on intent.
- The hierarchy constraints from the first transcript were re-checked on top of
  the vocabulary layer and behaved identically.
- `pg_dump --schema-only` round-tripped the composite level FK and the functional
  unique index on `lower(label)`.

**`open_notes_plan_claim_probe.log`** — the two silent-data-loss claims in Part
6, exercised against the shipped post-#69 modules in `apps/notes-next` with a
minimal `localStorage` stub.

- A snapshot rewritten with `schemaVersion: 2` reads back as `null`; the same
  payload at v1 restores its unsaved text. This is the version trap in 6.3.
- The shipped `serializeNoteDraft` marks a taxonomy move dirty; a signature
  omitting the taxonomy id is byte-identical before and after the move, so the
  move would never autosave. This is the signature trap in 6.1.
- A v1 signature and its v2 equivalent never match, so an upgrade that does not
  recompute `savedSignature` marks every restored note dirty.

That probe was a throwaway — the second half of each claim exercises
hypothetical v2 code rather than shipped behavior, so it is a demonstration, not
a regression test. The regression tests that _should_ be committed with the
implementation are listed in section 7.1.

**`hierarchy_concurrency_edge_cases.log`** — the two database-level edge cases
in section 6.6, run against a scratch database whose schema was **rebuilt from
this plan's own sections 2.3, 2.4 and the backfill appendix**. That rebuild is
itself a check: the plan is complete enough to implement the schema from without
reference to the earlier prototype scripts, which did not survive the VM.

- The label-upsert race (6.6c): with a concurrent uncommitted insert of the same
  label, the shipped `ON CONFLICT DO NOTHING` + `UNION ALL SELECT` pattern
  returns 0 rows, which makes the service throw; the `DO UPDATE … RETURNING id`
  variant returns the id.
- The roll-up shape (6.6d): 1 epic, 23 categories, 463 groups, 20,005 notes.
  Recursive CTE 26–31 ms across three runs, fixed-depth aggregate 5.5 ms, zero
  rows of disagreement between them, and the epic roll-up equal to the total
  note count.

The existing suites were also run after merging `main` into this branch:
`pnpm --filter notes-next test` passes 72/72.

The two client-side gaps in 6.6a and 6.6b were established by reading the
shipped code paths rather than by execution — `patchNoteFromSidebar`,
`applyServerNoteToEntry` and `rehydrateOpenNotes` are quoted directly in those
sections so the reasoning can be checked against the source.

## Validated phase-1 backfill SQL

The exact statements that were executed and verified, to be lifted into
`migrations/<stamp>__note_taxonomy_hierarchy.sql` after the table DDL from
sections 2.3 and 2.4. Order matters: the vocabulary seed must precede any
hierarchy row, or the level FK rejects it.

```sql
-- 0. tier vocabulary for every user. This must come first.
INSERT INTO public.user_taxonomy_level_v1 (user_id, level, label)
SELECT u.id, v.level, v.label
FROM public.user_v1 u
CROSS JOIN (VALUES (1, 'Epic'), (2, 'Category'), (3, 'Group'), (4, 'Note'))
  AS v(level, label)
ON CONFLICT DO NOTHING;

-- 1. one epic per user, for every user
INSERT INTO public.user_taxonomy_v1 (user_id, level, parent_id, label)
SELECT u.id, 1, NULL, 'uncategorized'
FROM public.user_v1 u
ON CONFLICT DO NOTHING;

-- 2. every existing category becomes a level-2 row under that user's epic.
--    The old table's UNIQUE (user_id, label) makes this label join 1:1.
INSERT INTO public.user_taxonomy_v1 (user_id, level, parent_id, label)
SELECT c.user_id, 2, e.id, c.label
FROM public.user_note_category_v1 c
JOIN public.user_taxonomy_v1 e
  ON e.user_id = c.user_id AND e.level = 1
ON CONFLICT DO NOTHING;

-- 3. backstop: an epic with no categories gets one, so users with zero
--    categories also end up with a complete chain
INSERT INTO public.user_taxonomy_v1 (user_id, level, parent_id, label)
SELECT e.user_id, 2, e.id, 'uncategorized'
FROM public.user_taxonomy_v1 e
WHERE e.level = 1
  AND NOT EXISTS (
    SELECT 1 FROM public.user_taxonomy_v1 c
    WHERE c.parent_id = e.id AND c.level = 2
  )
ON CONFLICT DO NOTHING;

-- 4. one group under every category, so existing notes have a home
INSERT INTO public.user_taxonomy_v1 (user_id, level, parent_id, label)
SELECT c.user_id, 3, c.id, 'uncategorized'
FROM public.user_taxonomy_v1 c
WHERE c.level = 2
ON CONFLICT DO NOTHING;

-- 5. notes move from category to group
ALTER TABLE public.user_note_v1 ADD COLUMN group_id integer;
ALTER TABLE public.user_note_v1 ADD COLUMN group_level smallint NOT NULL DEFAULT 3;
ALTER TABLE public.user_note_v1
  ADD CONSTRAINT user_note_v1_group_level_check CHECK (group_level = 3);

UPDATE public.user_note_v1 n
SET group_id = g.id
FROM public.user_note_category_v1 oldcat
JOIN public.user_taxonomy_v1 c
  ON c.user_id = oldcat.user_id AND c.level = 2 AND c.label = oldcat.label
JOIN public.user_taxonomy_v1 g
  ON g.parent_id = c.id AND g.level = 3 AND g.label = 'uncategorized'
WHERE oldcat.id = n.category_id
  AND n.group_id IS NULL;

ALTER TABLE public.user_note_v1 ALTER COLUMN group_id SET NOT NULL;
ALTER TABLE public.user_note_v1
  ADD CONSTRAINT user_note_v1_group_id_fkey
    FOREIGN KEY (group_id, group_level, user_id)
    REFERENCES public.user_taxonomy_v1 (id, level, user_id)
    ON DELETE RESTRICT;
CREATE INDEX user_note_v1_group_id_idx ON public.user_note_v1 (group_id);
```

The `SET NOT NULL` in step 5 is the safety net: because the runner wraps the file
in a transaction, a backfill that missed any note aborts the whole migration
rather than shipping a half-migrated table.

Note that the migration file must not contain `BEGIN` / `COMMIT` — the runner
adds them.
