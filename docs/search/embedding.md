# Semantic Search & Vector Embeddings

This document describes how vector-based semantic search works across the Notes
apps (`notes-next`, `notes-android`) and the shared database layer
(`@lib/db-notes`).

## Overview

Notes search is **semantic**, not keyword-based. Each searchable text field is
embedded into a 1024-dimensional vector using the Jina AI Embeddings API
(`jina-embeddings-v5-text-small`). When a user searches, the query text is
embedded with the same model (using a different task adapter). Postgres then
ranks notes by cosine similarity between the query vector and stored vectors.

Search spans three entity types:

| Entity   | Table                   | Embedded text | Column                  |
| -------- | ----------------------- | ------------- | ----------------------- |
| Note     | `user_note_v1`          | `description` | `description_embedding` |
| Category | `user_note_category_v1` | `label`       | `category_embedding`    |
| Tag      | `user_note_tag_v1`      | `label`       | `tag_embedding`         |

Every note belongs to exactly one category and may have zero or more tags. The
ranking formula combines description similarity with taxonomy similarity
(category + tags).

## PostgreSQL: pgvector extension

**Yes — vector comparison is performed in Postgres using the
[pgvector](https://github.com/pgvector/pgvector) extension.**

The extension is enabled in the first embeddings migration:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

### Column type

Embedding columns use pgvector's fixed-dimension type:

```sql
description_embedding vector(1024)
category_embedding    vector(1024)
tag_embedding         vector(1024)
```

Vectors are stored as JSON array literals at the application layer and cast to
`::vector` in SQL (for example `$2::vector`).

### Similarity operator

Search uses pgvector's **cosine distance** operator `<=>` with the
`vector_cosine_ops` operator class. Because Jina returns L2-normalized vectors
(`normalized: true`), cosine distance maps cleanly to a 0–1 similarity score:

```sql
1 - (stored_embedding <=> query_embedding::vector)
```

- `<=>` returns cosine **distance** (0 = identical, 2 = opposite).
- Subtracting from 1 yields cosine **similarity** (1 = identical, -1 = opposite).

The app never computes similarity in TypeScript; all distance math happens in
Postgres via pgvector operators.

### HNSW indexes

Each embedding column has an **HNSW** (Hierarchical Navigable Small World)
approximate-nearest-neighbor index:

```sql
CREATE INDEX ... USING hnsw (description_embedding vector_cosine_ops);
CREATE INDEX ... USING hnsw (category_embedding vector_cosine_ops);
CREATE INDEX ... USING hnsw (tag_embedding vector_cosine_ops);
```

These indexes support fast top-k nearest-neighbor queries on a single column.
The current search query in `sql/note/gets.ts` does **not** use them directly:
it scans all of a user's notes, computes a composite score across description +
category + tags, and sorts in SQL. This is appropriate for per-user note counts
but would need revisiting if cross-user or very large per-user search becomes a
requirement.

## Embedding model (Jina AI)

| Setting    | Value                                         |
| ---------- | --------------------------------------------- |
| Provider   | Jina AI (`https://api.jina.ai/v1/embeddings`) |
| Model      | `jina-embeddings-v5-text-small`               |
| Dimensions | 1024                                          |
| Normalized | `true` (L2 normalized for cosine via dot)     |
| Truncate   | `true`                                        |
| Timeout    | 30 seconds                                    |

The model version tag stored alongside each row is
`jina-embeddings-v5-text-small:notes-v3`. The maintenance endpoint uses this
tag to detect rows embedded with an older model version.

### Task types (asymmetric retrieval)

Jina v5 supports task-specific LoRA adapters that improve search quality for
short phrases:

| Task                | Used for                                               |
| ------------------- | ------------------------------------------------------ |
| `retrieval.passage` | Storing note descriptions, category labels, tag labels |
| `retrieval.query`   | Embedding user search queries                          |
| `text-matching`     | Symmetric similarity (not used)                        |

Passages (stored content) and queries (user input) are embedded with different
adapters. This asymmetric approach produces better rankings than using one
adapter for both sides.

## Database schema

Relevant columns on each table:

### `user_note_v1`

| Column                  | Type           | Source text       |
| ----------------------- | -------------- | ----------------- |
| `description_embedding` | `vector(1024)` | `description`     |
| `embedding_model`       | `text`         | model version tag |
| `embedding_updated_at`  | `timestamptz`  | last write        |

### `user_note_category_v1`

| Column                 | Type           | Source text       |
| ---------------------- | -------------- | ----------------- |
| `category_embedding`   | `vector(1024)` | `label`           |
| `embedding_model`      | `text`         | model version tag |
| `embedding_updated_at` | `timestamptz`  | last write        |

### `user_note_tag_v1`

| Column                 | Type           | Source text       |
| ---------------------- | -------------- | ----------------- |
| `tag_embedding`        | `vector(1024)` | `label`           |
| `embedding_model`      | `text`         | model version tag |
| `embedding_updated_at` | `timestamptz`  | last write        |

### Schema history (brief)

Embeddings evolved through several migrations:

1. **202603151000** — Initial pgvector setup (OpenAI `text-embedding-3-small`,
   1536 dims) on `title_embedding` and `content_embedding`.
2. **202603251200** — Per-column embeddings (`summary_embedding`,
   `description_embedding`).
3. **202604081200** — Switched to Jina v5 at 1024 dims; nulled all existing
   embeddings for regeneration.
4. **202604081300** — Dropped unused `content_embedding` (computed but never
   queried).
5. **202604221200+** — Category/tag taxonomy tables gained their own embedding
   columns.

Only `description_embedding` is embedded per note today. Category and tag
labels are embedded on their respective taxonomy rows.

## Embedding lifecycle

### On note create / update

`services/notes-app.ts` calls `createNoteEmbeddingInput()` before writing to
the database. This function:

1. Normalizes the description (trim whitespace, normalize line endings).
2. Skips the Jina call if the description is empty (embeddings set to `NULL`).
3. Otherwise sends the description to Jina with `task: "retrieval.passage"`.
4. Returns a `NoteEmbeddingWriteInput` with a JSON-serialized vector literal
   and the current model tag.

INSERT/UPDATE queries cast the literal to `::vector` and set
`embedding_updated_at`.

### On category / tag create / update

Creating or renaming a category or tag calls `createTagLabelEmbedding()` with
the normalized label and `task: "retrieval.passage"`, then writes the vector to
`category_embedding` or `tag_embedding` respectively.

### On search

`searchNotesForNotesApp()` embeds the query and runs the ranking SQL. **Search
does not backfill missing embeddings.** Notes or taxonomy rows with `NULL`
embeddings contribute zero to their similarity component but still appear in
results (ranked lower).

### Maintenance endpoint

`POST /api/notes/maintenance/embeddings` backfills or upgrades embeddings in
batches. The web app exposes a UI action that calls this endpoint.

| Mode      | Behavior                                                                                               |
| --------- | ------------------------------------------------------------------------------------------------------ |
| `missing` | Re-embed rows with at least one expected embedding column as NULL                                      |
| `stale`   | Re-embed rows whose `embedding_model` differs from the current version, or that are missing any column |

Request body:

```json
{
  "userId": 7,
  "mode": "missing",
  "limit": 100
}
```

Response:

```json
{
  "mode": "missing",
  "processed": 10,
  "updated": 10,
  "categoriesUpdated": 2,
  "tagsUpdated": 3,
  "hasMore": false
}
```

Call in a loop until `hasMore` is `false` to backfill or upgrade all rows for a
user. `limit` accepts 1–500 (default 100).

### Standalone regeneration script

`lib/db-notes/scripts/regenerate-embeddings.mjs` bulk-regenerates all
embeddings outside the app:

```bash
DB_NOTES_URL=… JINA_API_KEY=… node lib/db-notes/scripts/regenerate-embeddings.mjs [--user <id>] [--dry-run] [--batch-size <n>]
```

Keep this script in sync with `services/notes-embeddings.ts` when changing
model, dimensions, or text format.

## Query-time search

### API endpoint

`POST /api/notes/search`

Request body:

```json
{
  "userId": 7,
  "query": "grocery shopping list",
  "limit": 20
}
```

`limit` defaults to 20 and accepts 1–20 (`NOTES_APP_SEARCH_MAX_RESULTS`).

### Processing steps

1. **Normalize** the query string (`parseSearchRequest` / `normalizeSearchQuery`).
2. **Embed** via Jina with `task: "retrieval.query"` → single 1024-dim vector.
3. **Rank** in Postgres: for each user note, compute per-field cosine
   similarities using pgvector's `<=>` operator.
4. **Combine** into a composite score, sort descending, apply `LIMIT`.

### Ranking formula

From `sql/note/gets.ts`:

```
taxonomy_similarity =
  category_similarity                          -- if only category has embedding
  tag_similarity                               -- if only tags have embeddings
  (category_similarity + tag_similarity) / 2   -- if both present
  NULL                                         -- if neither present

score = description_similarity * 0.67 + taxonomy_similarity * 0.33
```

- **Description** (67%): cosine similarity between query and
  `description_embedding`.
- **Taxonomy** (33%): average of the note's category similarity and the average
  tag similarity across linked tags. When only one side has embeddings, that
  side alone contributes.

NULL similarities are treated as 0 in the final score. All user notes are
included in the result set (up to `limit`), so low-relevance matches appear
after stronger ones rather than being excluded.

**Ordering:** `semantic_similarity DESC, time_modified DESC`.

### Response shape

```json
{
  "results": [
    {
      "note": { "id": 41, "description": "...", "...": "..." },
      "similarity": 0.87,
      "tagSimilarity": 0.79,
      "descriptionSimilarity": 0.82
    }
  ]
}
```

| Field                   | Meaning                                     |
| ----------------------- | ------------------------------------------- |
| `similarity`            | Composite score used for ordering           |
| `descriptionSimilarity` | Query ↔ note description cosine similarity |
| `tagSimilarity`         | Average query ↔ linked tag similarities    |

`categorySimilarity` is computed in SQL for ranking but is not part of the
public `SemanticSearchResult` contract.

## Client behavior

### notes-next (web)

`NotesApp.tsx` debounces search input (250 ms) and calls
`POST /api/notes/search`. While a query is active, the note list switches from
chronological order to relevance order and shows a similarity percentage badge.
The app can also trigger embedding maintenance from the UI.

### notes-android

The Android client calls the same `POST /api/notes/search` endpoint on the
deployed `notes-next` REST API (`NotesApiClient.kt`). Ranking is identical.
Search results are cached in `SessionStore` and restored on session reload when
`lastSearchQuery` is non-blank.

## Environment

| Variable       | Required          | Purpose                                             |
| -------------- | ----------------- | --------------------------------------------------- |
| `JINA_API_KEY` | Yes               | Jina AI API authentication                          |
| `DB_NOTES_URL` | Yes (script only) | Postgres connection for `regenerate-embeddings.mjs` |

If `JINA_API_KEY` is missing, search and note/taxonomy writes that require
embedding return a 500 with "JINA_API_KEY environment variable not set."

## Architecture diagram

```
┌─────────────┐     retrieval.query      ┌──────────────┐
│ User query  │ ────────────────────────▶│  Jina AI API │
└─────────────┘                          └──────┬───────┘
                                                │ 1024-dim vector
                                                ▼
┌─────────────┐   <=> cosine distance   ┌──────────────┐
│ notes-next  │ ◀───────────────────────│  PostgreSQL  │
│ /api/search │                         │  + pgvector  │
└─────────────┘                         └──────▲───────┘
                                               │
                    retrieval.passage          │ stored vectors
┌─────────────┐                          ┌─────┴────────┐
│ Note CRUD   │ ──embed on write───────▶│  Jina AI API │
│ Category/   │                          └────────────┘
│ Tag CRUD    │
└─────────────┘
```

## Key source files

| Path                                                                | Role                                                        |
| ------------------------------------------------------------------- | ----------------------------------------------------------- |
| `lib/db-notes/services/notes-embeddings.ts`                         | Jina API calls, text normalization, vector generation       |
| `lib/db-notes/services/notes-app.ts`                                | Orchestrates embed-then-write for CRUD, search, maintenance |
| `lib/db-notes/sql/note/gets.ts`                                     | Search SQL with pgvector `<=>` ranking                      |
| `lib/db-notes/sql/note/add.ts`                                      | INSERT with `description_embedding`                         |
| `lib/db-notes/sql/note/update.ts`                                   | UPDATE with embeddings, backfill UPDATE                     |
| `lib/db-notes/sql/category.ts`                                      | Category embedding backfill queries                         |
| `lib/db-notes/sql/tag.ts`                                           | Tag embedding backfill queries                              |
| `lib/db-notes/notes-search-constants.ts`                            | `NOTES_APP_SEARCH_MAX_RESULTS` (20)                         |
| `lib/db-notes/migrations/202603151000__note_embeddings.sql`         | `CREATE EXTENSION vector`, initial indexes                  |
| `lib/db-notes/migrations/202604081200__jina_embeddings_v5_1024.sql` | Jina v5 / 1024-dim migration                                |
| `lib/db-notes/scripts/regenerate-embeddings.mjs`                    | Bulk offline regeneration                                   |
| `apps/notes-next/app/api/notes/search/route.ts`                     | Next.js search route                                        |
| `apps/notes-next/app/api/notes/maintenance/embeddings/route.ts`     | Maintenance route                                           |
| `apps/notes-next/src/components/notes/NotesApp.tsx`                 | Client search UI and debounce                               |
| `apps/notes-android/.../NotesApiClient.kt`                          | Android search API client                                   |
