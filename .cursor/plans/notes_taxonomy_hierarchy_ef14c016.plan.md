---
name: Notes Taxonomy — Epic > Category > Group > Note hierarchy
overview: Documents how notes are persisted today (flat single-category taxonomy plus many-to-many tags) and plans the extension to a four-level strict hierarchy — Epic > Category > Group > Note — where every child has exactly one parent, tags stay many-to-many on notes, every taxonomy level carries a label embedding for autocomplete, and semantic note search is simplified to compare the query against the note description embedding only. The recommended schema is a single self-referencing user_note_taxonomy_v1 table whose depth, parent level, and per-user ownership are enforced declaratively by composite foreign keys; the DDL, the backfill, and the search rewrite were prototyped and validated against a real PostgreSQL 17 + pgvector 0.8.6 cluster before this plan was written.
todos:
  - id: schema_migration_phase1
    content: "Phase 1 (additive) migration: create user_note_taxonomy_v1 with composite-FK level/ownership enforcement and partial HNSW label indexes; backfill an epic + a category row per existing category + a group per category; add user_note_v1.group_id (+ pinned group_level) and backfill it from category_id. Leaves user_note_category_v1 and user_note_v1.category_id in place."
    status: pending
  - id: verify_contract_phase1
    content: Extend scripts/verify-contract.mjs with must-exist assertions for the new table, columns, constraints, indexes and trigger, plus the structural invariants (no level skew, no cross-user parenting, every user has an epic/category/group chain)
    status: pending
  - id: merge_registry
    content: Register user_note_taxonomy_v1 in MERGE_TABLE_STRATEGIES and rewrite mergeAnonymousUserInto to remap a three-level subtree instead of a flat category list (db:verify fails until this is done)
    status: pending
  - id: contract_types
    content: "Replace CategoryRecord with TaxonomyRecord (id, userId, level, parentId, label, noteCount, directNoteCount, lastUsedAt) in contracts/notes-app.ts; change NoteInput.categoryId to groupId; add NoteRecord.group/category/epic refs; simplify SemanticSearchResult to { note, similarity }"
    status: pending
  - id: sql_service_layer
    content: Collapse sql/category.ts into sql/taxonomy.ts (level-parameterized CRUD, subtree note counts, per-level fallback resolution, move/reparent, delete-with-children and delete-with-notes) and update sql/note/* to read and write group_id
    status: pending
  - id: search_simplify
    content: Rewrite searchNotesByEmbedding as an exact per-user description-only scan (drop the 0.67/0.33 composite, the category join and the tag AVG subquery); do NOT switch to an index-ordered HNSW scan — it silently returns 0 rows for users holding a small share of the table
    status: pending
  - id: autocomplete_endpoint
    content: Add level-scoped label autocomplete (literal prefix match first, embedding similarity as semantic fallback) backed by label_embedding, and extend embed-on-write plus embedding maintenance to all three taxonomy levels
    status: pending
  - id: api_routes
    content: Replace /api/categories with /api/taxonomy (level-aware CRUD + move), add /api/taxonomy/suggest, update /api/notes payloads, update /api/embeddings/debug and /embeddings to drop composite scoring
    status: pending
  - id: frontend
    content: Rework NotesApp/ResultsColumn/NoteForm/notesAppStore/notesCache from two flat accordions into a hierarchy tree with a three-step picker and hierarchical URL state
    status: pending
  - id: android_contract
    content: Update Android Models.kt/JsonCodec.kt/NotesApiClient.kt and the widget filters for the new contract, then run contracts:check and rebuild the APK
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

This document has two halves. **Part 1** documents the current persistence
architecture as it actually exists. **Part 2** onward is the plan to extend it.

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

Creating or updating a note (`POST` / `PATCH /api/notes`):

1. **Client** — `NotesApp.tsx` builds the payload from the Zustand note-form
   state:

   ```ts
   {
     categoryId: form.selectedCategoryId,
     tagIds: form.selectedTagIds,
     description: form.description,
     timeDue: form.dueExpanded ? form.timeDue : null,
     timeRemind: form.remindExpanded ? form.timeRemind : null,
   }
   ```

2. **Auth** — the route derives the acting user from the NextAuth session cookie
   or an `Authorization: Bearer` token. Any client-supplied `userId` is
   overwritten server-side in `readAuthorizedJsonObject`.

3. **Parse** — `parseCreateNoteRequest` → `parseNoteInput` (`sql/note/parse.ts`)
   coerces `categoryId` to a positive integer, de-duplicates `tagIds`, and
   normalizes `timeDue` / `timeRemind` to ISO strings or `null`.

4. **Embed before write** — `createNoteForNotesApp` calls
   `createNoteEmbeddingInput`, which sends the trimmed description to Jina with
   `task: "retrieval.passage"` and returns a `vector(1024)` literal plus the
   model tag `jina-embeddings-v5-text-small:notes-v3`. An empty description
   yields `{ descriptionEmbedding: null, embeddingModel: null }`. **A Jina
   outage fails the note save** — the embedding call is not deferred or
   best-effort.

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
- **"Default" category/tag = lowest numeric id** (`getFirstCategoryForUser`
  orders by `id ASC LIMIT 1`).
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
`user_note_taxonomy_v1` with `level smallint` (1=epic, 2=category, 3=group) and
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
  epic under a category" — does not apply here. Section 2.3 makes depth,
  parent level, _and_ per-user ownership fully declarative, with no triggers.
  Section 2.5 shows every violation being rejected by Postgres.

The remaining honest cost of Option B is that ancestor lookups need a join per
level (or a recursive CTE for arbitrary-depth roll-ups) rather than a single
typed FK, and that the migration has to move the existing category rows into the
new table instead of leaving them where they are. Both are handled below and
neither showed up as a performance problem in the prototype.

## 2.3 Recommended schema

```sql
CREATE TABLE public.user_note_taxonomy_v1 (
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

    CONSTRAINT user_note_taxonomy_v1_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES public.user_v1(id) ON DELETE CASCADE,

    CONSTRAINT user_note_taxonomy_v1_level_check
      CHECK (level >= 1 AND level <= 3),

    CONSTRAINT user_note_taxonomy_v1_label_lowercase_check
      CHECK (label = lower(btrim(label))),

    -- exactly the roots have no parent, and only roots may have none
    CONSTRAINT user_note_taxonomy_v1_root_parent_check
      CHECK ((level = 1) = (parent_id IS NULL)),

    -- target of the self-referencing composite FK below; user_id is part of the
    -- key so "parent must belong to the same user" is declarative too
    CONSTRAINT user_note_taxonomy_v1_id_level_user_key
      UNIQUE (id, level, user_id),

    CONSTRAINT user_note_taxonomy_v1_parent_fkey
      FOREIGN KEY (parent_id, parent_level, user_id)
      REFERENCES public.user_note_taxonomy_v1 (id, level, user_id)
      ON DELETE RESTRICT,

    -- NULLS NOT DISTINCT (PG15+) so the constraint also applies to level-1 rows
    CONSTRAINT user_note_taxonomy_v1_sibling_label_key
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
CREATE INDEX user_note_taxonomy_v1_user_id_level_idx
  ON public.user_note_taxonomy_v1 (user_id, level);

CREATE INDEX user_note_taxonomy_v1_parent_id_idx
  ON public.user_note_taxonomy_v1 (parent_id);

-- one partial HNSW index per level, so level-scoped autocomplete never has to
-- post-filter a mixed-level index
CREATE INDEX user_note_taxonomy_v1_epic_embedding_hnsw_idx
  ON public.user_note_taxonomy_v1 USING hnsw (label_embedding public.vector_cosine_ops)
  WHERE level = 1;
-- …_category_embedding_hnsw_idx WHERE level = 2
-- …_group_embedding_hnsw_idx    WHERE level = 3

CREATE TRIGGER user_note_taxonomy_v1_apply_row_timestamps_v1
BEFORE INSERT OR UPDATE ON public.user_note_taxonomy_v1
FOR EACH ROW EXECUTE FUNCTION public.apply_row_timestamps_v1();
```

A measured caveat on those HNSW indexes: at realistic taxonomy sizes the planner
correctly prefers a sequential scan (a user with a few thousand groups still
sorts in well under a millisecond), so they buy nothing today. They are cheap
(24 kB each in the prototype) and they are the right shape if a user ever grows
a very large taxonomy. **If you prefer to keep the schema minimal, dropping all
three and relying on `user_note_taxonomy_v1_user_id_level_idx` is a defensible
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
    REFERENCES public.user_note_taxonomy_v1 (id, level, user_id)
    ON DELETE RESTRICT;
CREATE INDEX user_note_v1_group_id_idx ON public.user_note_v1 (group_id);
```

`group_level` is a constant column pinned to 3 by a `CHECK`. It exists purely so
the composite FK can express "this must be a level-3 row belonging to this
note's own user". That single constraint replaces
`ensureCategoryIdForUser`'s application-side ownership check _and_ guarantees
notes can never be attached to an epic or a category.

## 2.4 Resulting relationships

| Relationship                | Cardinality      | Enforced by                          |
| --------------------------- | ---------------- | ------------------------------------ |
| user → taxonomy rows        | one-to-many      | `user_id` FK, `ON DELETE CASCADE`    |
| epic → categories           | one-to-many      | composite parent FK, `level` 1→2     |
| category → groups           | one-to-many      | composite parent FK, `level` 2→3     |
| group → notes               | one-to-many      | `user_note_v1_group_id_fkey`         |
| category → epic             | **exactly one**  | `parent_id` NOT NULL for `level > 1` |
| group → category            | **exactly one**  | same                                 |
| note → group                | **exactly one**  | `group_id` NOT NULL + FK             |
| note ↔ tags                | **many-to-many** | `user_note_tag_link_v1`, unchanged   |
| parent and child same owner | always           | `user_id` in the composite FK        |

## 2.5 Verified constraint behavior

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
| Uppercase label                                    | rejected                       | `label_lowercase_check`                           |
| Deleting the user                                  | **cascades** the whole subtree | `user_id` FK                                      |

`pg_dump` round-trips all of it — the generated column, both composite FKs and
`UNIQUE NULLS NOT DISTINCT` reappear verbatim — so `snapshot-schema.sh` and the
`db:verify` artifact diff work unchanged. `generate-types.mjs` already maps
`int2` to `number`, so `level` and `parent_level` need no generator change.

---

# Part 3 — Migration plan

Two migrations, deliberately split. `manifest.yaml` declares an
`additive-first` compatibility policy, and Railway migrates the database before
the app deploy, so phase 1 must leave the currently-deployed code working.

## 3.1 Phase 1 — additive (deploy with, or before, the new code)

`migrations/<stamp>__note_taxonomy_hierarchy.sql`:

1. Create `user_note_taxonomy_v1` with all constraints, indexes, and the
   timestamp trigger (section 2.3).
2. **One epic per user**, for _every_ row in `user_v1` — not only users who
   already have categories. This is what finally guarantees the fallback chain
   always resolves, removing the `ensureFallbackCategoryId` "should never
   happen" throw. It follows the precedent of
   `202606101200__seed_default_important_tag.sql`.
3. **Every existing category becomes a level-2 row** under that user's epic,
   preserving the label. The old table's `UNIQUE (user_id, label)` makes a label
   join a safe 1:1 mapping, so no temporary id-mapping column is needed.
4. **Backstop**: any epic with no categories gets a `general` category, so users
   with zero categories are also complete.
5. **One `general` group under every category**, giving existing notes a home.
6. Add `user_note_v1.group_id` (nullable) and `group_level` (default 3, pinned
   by `CHECK`), backfill `group_id` by joining old category → new level-2 row →
   its `general` group, then `SET NOT NULL`, add the composite FK, add the
   index.

The old `user_note_category_v1` table and `user_note_v1.category_id` are
untouched, so the currently-deployed app keeps working against them.

**Verified on seeded data**: 2 users, 4 categories, 6 notes including one with a
`NULL` description and one anonymous user's note. The migration applied in a
single transaction and backfilled all 6 notes with no nulls left; the resulting
tree read back correctly through a three-level join.

**Label choice for the auto-created rows.** The prototype used `general` for the
default epic and the per-category group. `general` is sibling-scoped so it is
free of collisions, but it will be visible in the UI for every existing note —
confirm the wording (`general` vs `default` vs repeating the category label)
before running this in production. Note that whatever is chosen must satisfy
`label = lower(btrim(label))`.

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

- `user_note_taxonomy_v1` added to the expected-tables `IN` list.
- Column type and nullability assertions for `level`, `parent_id`,
  `parent_level`, `label`, `label_embedding`, `embedding_model`,
  `embedding_updated_at`.
- Named-constraint counts (`pg_constraint`) for `user_id_fkey`, `level_check`,
  `label_lowercase_check`, `root_parent_check`, `id_level_user_key`,
  `parent_fkey`, `sibling_label_key`, plus `user_note_v1_group_id_fkey` and
  `user_note_v1_group_level_check`.
- Named-index counts (`pg_indexes`) for `user_id_level_idx`, `parent_id_idx`,
  the three partial HNSW indexes (if kept), and `user_note_v1_group_id_idx`.
- Trigger name added to the existing `tgname IN (…)` list.
- **Structural data invariants**, in the spirit of the existing "every user must
  have the default important tag" check. These catch a broken backfill, which
  named-object assertions cannot:
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

`db:verify` will fail until `user_note_taxonomy_v1` is added to
`MERGE_TABLE_STRATEGIES`. The strategy is `dedup-remap`, but the merge SQL in
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

`testing/anonymous-merge.test.ts` needs cases for a multi-level subtree, for
same-label groups under different categories, and for a partial-overlap tree
(shared epic, new category).

---

# Part 4 — Contract, API and service changes

## 4.1 `contracts/notes-app.ts`

```ts
export const TAXONOMY_LEVEL_EPIC = 1
export const TAXONOMY_LEVEL_CATEGORY = 2
export const TAXONOMY_LEVEL_GROUP = 3

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
group actually holding the notes. Section 2.5's recursive CTE computes both.

## 4.2 Routes

| Route                                    | Change                                                                                                        |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `GET /api/taxonomy`                      | new; returns the user's whole tree as a flat `TaxonomyRecord[]` (the client builds the tree — one round trip) |
| `POST /api/taxonomy`                     | new; `{ level, parentId, label }`                                                                             |
| `PATCH /api/taxonomy`                    | new; rename (`{ id, label }`) **and** move (`{ id, parentId }`)                                               |
| `DELETE /api/taxonomy`                   | new; needs an explicit child/note disposition — see 4.4                                                       |
| `POST /api/taxonomy/suggest`             | new; level-scoped label autocomplete                                                                          |
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
- **`sql/note/parse.ts`** — `parseCategoryId` → `parseGroupId`.
- **`services/notes-app.ts`** — `createLabeledEntityForNotesApp` and
  `updateLabeledEntityForNotesApp` already take a `tableName` and an embedding
  column name; they collapse to a single taxonomy path with a `level` argument.
  `createTagLabelEmbedding` is already generic over labels and needs only a
  rename (`createLabelEmbedding`) to stop reading as tag-specific.
  `maintainNoteEmbeddingsForNotesApp` walks taxonomy rows once instead of
  categories and tags separately.
- **`ensureFallbackCategoryId`** becomes a per-level fallback resolver. With the
  phase-1 backfill guaranteeing a full chain per user, it can stop throwing.

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
4. **Are labels still globally lowercased?** Recommendation: keep it. It is
   already enforced by `CHECK` at every level and is what makes the upsert-by-
   label pattern deterministic.
5. **Moving a subtree.** Re-parenting a category moves all its groups and notes
   implicitly, since children reference the parent by id. No cascade logic is
   needed — but the sibling-label unique constraint can reject a move into a
   parent that already has that label, and the API must surface that as a
   conflict rather than a 500.

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
JOIN public.user_note_taxonomy_v1 g ON g.id = n.group_id
JOIN public.user_note_taxonomy_v1 c ON c.id = g.parent_id
JOIN public.user_note_taxonomy_v1 e ON e.id = c.parent_id
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
`user_note_taxonomy_v1.label_embedding` and serve autocomplete (section 5.3).

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
already picked a parent. Section 2.3's measurement applies here too: at
realistic taxonomy sizes this is a sub-millisecond sequential scan, so the
embedding step's cost is the Jina round trip, not the SQL. Debounce it in the
client and skip it for queries under ~3 characters.

## 5.4 Embedding write paths

- Embed-on-write on taxonomy create and rename, at all three levels (reuse the
  existing create/update label paths).
- `maintainNoteEmbeddingsForNotesApp` walks `user_note_taxonomy_v1` for
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

# Part 6 — Client changes

## 6.1 `apps/notes-next`

The current UI encodes "flat categories + flat tags" everywhere. Highest-impact
files:

- **`src/components/notes/NotesApp.tsx`** — the orchestrator. Loads
  `categories`/`tags`/`notes` into local state, groups notes by flat category and
  flat tag, syncs `?id=`, `?category=`, `?tags=` to the URL, and owns every CRUD
  call. Needs: a taxonomy fetch, tree-shaped grouping, hierarchical URL state
  (`?epic=&category=&group=`), and `groupId` in the note payload.
- **`src/components/notes/ResultsColumn.tsx`** — today two flat accordions
  (Categories, Tags) plus a search-results section, with per-note "Move" and
  per-category edit/delete actions. Becomes an expand/collapse tree with
  per-level actions; roll-up counts come from `TaxonomyRecord.noteCount`.
- **`src/components/notes/NoteForm.tsx`** — the single category combobox becomes
  a three-step Epic → Category → Group picker where each step scopes the next.
  Per decision 4.4-2, the group step should be able to auto-create a default.
- **`src/components/ui/FilterablePickerPopup.tsx`** — generic filter/select/
  create popup, already used for both categories and tags. Extend it with an
  async suggestion source so it can call `/api/taxonomy/suggest`.
- **`src/stores/notesAppStore.ts`** — `manuallyExpandedCategoryId: number | null`
  becomes a set of expanded node ids; `noteForm.selectedCategoryId` becomes
  `selectedGroupId` plus the in-progress epic/category selection;
  `categoryInputValue` becomes per-level input state.
- **`src/lib/notesCache.ts`** — `NotesCacheSnapshot` swaps `categories` for
  `taxonomy`. Bump the cache key so stale snapshots are discarded rather than
  mis-parsed.
- **`src/components/notes/modals/*`** — the four category/tag modals become
  level-aware; the delete modal needs the 4.4-1 disposition options.
- **`src/types/notes.ts`** — `NoteFormState`, `noteToFormState`.
- **`src/components/notes/NoteResultsList.tsx`** — the similarity badge still
  reads `similarity`; only the removed sibling fields matter.
- **`app/embeddings/page.tsx`** — drop the tag inputs and the composite score
  readout; optionally add a taxonomy-autocomplete probe.
- **`test/notes-api-adapter.test.ts`** and
  **`lib/db-notes/testing/notes-api-adapter-suite.ts`** — the shared suite is
  where category CRUD, note CRUD, search and embedding maintenance are asserted;
  it must be rewritten alongside the contract, and it is the cheapest place to
  pin the new hierarchy rules.

Per repo convention, app-wide UI state belongs in the Zustand store rather than
being prop-drilled — the tree expansion state and the multi-step picker
selection both qualify.

## 6.2 `apps/notes-android`

Gated by `apps/notes-android/tools/validate-notes-contract.mjs`, which checks
field _order_ and Kotlin types, so these edits are mandatory, not optional:

- `app/.../model/Models.kt` — replace `CategoryRecord`/`NoteCategoryRef` with
  `TaxonomyRecord`/`TaxonomyRef`; update `NoteRecord`, `NoteDraft`
  (`selectedCategoryId` → `selectedGroupId`), `SemanticSearchResult`,
  `AppSnapshot`.
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

# Part 7 — Rollout order

1. Land the phase-1 migration, `verify-contract.mjs` additions, the
   `MERGE_TABLE_STRATEGIES` entry and the rewritten merge SQL. Run
   `pnpm run db:migrate` then `pnpm run db:verify` on the branch — `db:verify`
   also regenerates and diffs `schema/current.sql`, `db-types.ts`,
   `db-schema.json` and `notes-app.json`, so commit those artifacts with the
   migration.
2. Land the contract change plus the `@lib/db-notes` SQL/service rewrite,
   including the simplified search. Update the shared adapter suite in the same
   commit — it is the contract's executable specification.
3. Land the `notes-next` API routes, then the UI.
4. Land the Android contract updates; `contracts:check`; build the APK.
5. Deploy: `pnpm run release:notes:prepare`, run `db:migrate` against the target
   Notes DB, deploy `notes-next` on Railway.
6. Run embedding maintenance (`mode: "missing"`) or the extended
   `db:embeddings:regenerate` so the backfilled taxonomy rows get label vectors —
   the migration inserts them with `label_embedding` NULL and autocomplete stays
   empty until this runs.
7. Only then land phase 2 (drop `category_id` and `user_note_category_v1`, flip
   the verify assertions to must-be-absent, optionally drop the note HNSW
   index).

Local verification for each step, per repo conventions:

```bash
sudo pg_ctlcluster 17 main start
export PATH="/usr/lib/postgresql/17/bin:$PATH"
pnpm run db:migrate && pnpm run db:verify
pnpm --filter @lib/db-notes test          # set DB_NOTES_TEST_URL for the DB suite
pnpm run verify                            # db contracts + notes-web + android
```

`DB_NOTES_TEST_URL` must point at a throwaway database — the merge suite
deliberately never connects to `DB_NOTES_URL`, which in cloud environments is
the real Notes database.

---

# Part 8 — Risks

| Risk                                                                                                                                                                                                                    | Mitigation                                                                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Silent search-recall regression if someone "optimizes" the simplified query onto the HNSW index — it passes review and passes a manual test on a well-populated account, then returns nothing for the smallest accounts | Documented in 5.2 with a reproduction; add an adapter-suite test that seeds one user with many notes and another with a handful and asserts _both_ get a full page of results |
| Backfill leaves notes without a group                                                                                                                                                                                   | `SET NOT NULL` in the same migration fails the transaction; plus the 3.3 structural invariants in `db:verify`                                                                 |
| `db:verify` fails after merge because `verify-contract.mjs` was not updated                                                                                                                                             | Called out as the known top cause; update it in the same commit as the migration                                                                                              |
| Anonymous merge loses data on the three-level remap                                                                                                                                                                     | Level-ordered remap (3.4), `FOR UPDATE` locks preserved, expanded DB-backed regression tests                                                                                  |
| Released APK breaks when `/api/categories` disappears                                                                                                                                                                   | Keep a read-only level-2 alias until the APK is rebuilt (4.2)                                                                                                                 |
| Autocomplete returns nothing after rollout                                                                                                                                                                              | Embeddings are NULL until step 6 runs; the literal prefix half of the hybrid still works, which is why hybrid is recommended                                                  |
| Phase 2 runs before the new code deploys                                                                                                                                                                                | Two separate migrations; phase 1 is additive and leaves the old table readable                                                                                                |

---

# Appendix — Verification transcript

Environment: PostgreSQL 17.11 + pgvector 0.8.6. Both runs start from a dropped
database and load the real `lib/db-notes/schema/current.sql`, so they reproduce
from scratch.

Two transcripts were captured:

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

## Validated phase-1 backfill SQL

The exact statements that were executed and verified, to be lifted into
`migrations/<stamp>__note_taxonomy_hierarchy.sql` after the table DDL from
section 2.3. Confirm the `general` label choice (section 3.1) first.

```sql
-- 1. one epic per user, for every user
INSERT INTO public.user_note_taxonomy_v1 (user_id, level, parent_id, label)
SELECT u.id, 1, NULL, 'general'
FROM public.user_v1 u
ON CONFLICT DO NOTHING;

-- 2. every existing category becomes a level-2 row under that user's epic.
--    The old table's UNIQUE (user_id, label) makes this label join 1:1.
INSERT INTO public.user_note_taxonomy_v1 (user_id, level, parent_id, label)
SELECT c.user_id, 2, e.id, c.label
FROM public.user_note_category_v1 c
JOIN public.user_note_taxonomy_v1 e
  ON e.user_id = c.user_id AND e.level = 1
ON CONFLICT DO NOTHING;

-- 3. backstop: an epic with no categories gets one, so users with zero
--    categories also end up with a complete chain
INSERT INTO public.user_note_taxonomy_v1 (user_id, level, parent_id, label)
SELECT e.user_id, 2, e.id, 'general'
FROM public.user_note_taxonomy_v1 e
WHERE e.level = 1
  AND NOT EXISTS (
    SELECT 1 FROM public.user_note_taxonomy_v1 c
    WHERE c.parent_id = e.id AND c.level = 2
  )
ON CONFLICT DO NOTHING;

-- 4. one group under every category, so existing notes have a home
INSERT INTO public.user_note_taxonomy_v1 (user_id, level, parent_id, label)
SELECT c.user_id, 3, c.id, 'general'
FROM public.user_note_taxonomy_v1 c
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
JOIN public.user_note_taxonomy_v1 c
  ON c.user_id = oldcat.user_id AND c.level = 2 AND c.label = oldcat.label
JOIN public.user_note_taxonomy_v1 g
  ON g.parent_id = c.id AND g.level = 3 AND g.label = 'general'
WHERE oldcat.id = n.category_id
  AND n.group_id IS NULL;

ALTER TABLE public.user_note_v1 ALTER COLUMN group_id SET NOT NULL;
ALTER TABLE public.user_note_v1
  ADD CONSTRAINT user_note_v1_group_id_fkey
    FOREIGN KEY (group_id, group_level, user_id)
    REFERENCES public.user_note_taxonomy_v1 (id, level, user_id)
    ON DELETE RESTRICT;
CREATE INDEX user_note_v1_group_id_idx ON public.user_note_v1 (group_id);
```

The `SET NOT NULL` in step 5 is the safety net: because the runner wraps the file
in a transaction, a backfill that missed any note aborts the whole migration
rather than shipping a half-migrated table.

Note that the migration file must not contain `BEGIN` / `COMMIT` — the runner
adds them.
