# Semantic Search & Vector Embeddings

This document describes how vector-based semantic search works across the Notes
web app (`notes-next`) and the shared database layer
(`@lib/db-items`).

## Overview

Notes search is **semantic**, not keyword-based. Each searchable text field is
embedded into a 1024-dimensional vector using the Jina AI Embeddings API
(`jina-embeddings-v5-text-small`). When a user searches, the query text is
embedded with the same model (using a different task adapter). Postgres then
ranks notes by cosine similarity between the query vector and stored vectors.

Embeddings are stored on three entity types:

| Entity   | Table                   | Embedded text | Column                  |
| -------- | ----------------------- | ------------- | ----------------------- |
| Note     | `workspace_item_v1`     | `description` | `description_embedding` |
| Category | `workspace_category_v1` | `label`       | `category_embedding`    |
| Tag      | `workspace_tag_v1`      | `label`       | `tag_embedding`         |

Every note belongs to one workspace, may have one category, one status, and zero or
more tags. Category and tag labels have embeddings, which embedding maintenance
writes, but search ranking uses only the note's description embedding.

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
The current search query in `sql/item/gets.ts` scans the active workspace's notes,
compares each note's `description_embedding` to the query, and sorts in SQL.
This is appropriate for per-user note counts but would need revisiting if
cross-user or very large per-user search becomes a requirement.

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

### `workspace_item_v1`

| Column                  | Type           | Source text       |
| ----------------------- | -------------- | ----------------- |
| `description_embedding` | `vector(1024)` | `description`     |
| `embedding_model`       | `text`         | model version tag |
| `embedding_updated_at`  | `timestamptz`  | last write        |

### `workspace_category_v1`

| Column                 | Type           | Source text       |
| ---------------------- | -------------- | ----------------- |
| `category_embedding`   | `vector(1024)` | `label`           |
| `embedding_model`      | `text`         | model version tag |
| `embedding_updated_at` | `timestamptz`  | last write        |

### `workspace_tag_v1`

| Column                 | Type           | Source text       |
| ---------------------- | -------------- | ----------------- |
| `tag_embedding`        | `vector(1024)` | `label`           |
| `embedding_model`      | `text`         | model version tag |
| `embedding_updated_at` | `timestamptz`  | last write        |

Only `description_embedding` is embedded per note. Category and tag labels are
embedded on their respective taxonomy rows.

## Embedding lifecycle

### On note create / update

A write never waits on Jina. A new note, or one whose text changed, is stored with
`description_embedding`, `embedding_model`, and `embedding_updated_at` empty. After
the response is sent, the route handler calls `embedItemForItemsApp`
(`services/items-app.ts`), which does nothing for an item that has no text or already
has a current embedding. Otherwise `createItemEmbeddingInput()`:

1. Normalizes the description (trim whitespace, normalize line endings).
2. Sends it to Jina with `task: "retrieval.passage"`.
3. Returns a JSON-serialized vector literal and the current model tag.

`updateItemEmbeddingsForUser` casts the literal to `::vector`, sets
`embedding_updated_at`, and leaves `time_modified` unchanged. It stores the embedding
only while the item still holds the text that was embedded. A trash restore and a
journal combine are followed by the same call. When Jina fails, the item stays without
an embedding until the maintenance endpoint writes it.

### On category / tag create / update

A category or tag is created without an embedding, and a rename clears the one it
had. The maintenance endpoint embeds labels with `task: "retrieval.passage"` and
writes `category_embedding` or `tag_embedding`.

### On search

`searchItemsForItemsApp()` embeds the query and runs the ranking SQL. **Search
does not backfill missing embeddings.** Notes with a `NULL` description
embedding score 0 but still appear in results (ranked lower).

### Maintenance endpoint

`POST /api/items/maintenance/embeddings` backfills or upgrades embeddings in
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

`lib/db-items/scripts/regenerate-embeddings.mjs` bulk-regenerates all
embeddings outside the app:

```bash
DB_ITEMS_URL=… JINA_API_KEY=… node lib/db-items/scripts/regenerate-embeddings.mjs [--user <id>] [--dry-run] [--batch-size <n>]
```

Keep this script in sync with `services/item-embeddings.ts` when changing
model, dimensions, or text format.

## Query-time search

### API endpoint

`POST /api/items/search`

Request body:

```json
{
  "userId": 7,
  "query": "grocery shopping list",
  "limit": 20
}
```

`limit` defaults to 20 and accepts 1–20 (`ITEMS_APP_SEARCH_MAX_RESULTS`).

### Processing steps

1. **Normalize** the query string (`parseSearchRequest` / `normalizeSearchQuery`).
2. **Embed** via Jina with `task: "retrieval.query"` → single 1024-dim vector.
3. **Rank** in Postgres: for each user note, compute cosine similarity between
   the query vector and `description_embedding` using pgvector's `<=>`
   operator.
4. **Sort** descending by that score and apply `LIMIT`.

### Ranking formula

From `sql/item/gets.ts`:

```
score = cosine_similarity(query, description_embedding)
      = 1 - (description_embedding <=> query_embedding)
```

Notes with a `NULL` description embedding score 0. Category and tag embeddings
are not consulted. All user notes are included in the result set (up to
`limit`), so low-relevance matches appear after stronger ones rather than being
excluded.

**Ordering:** `semantic_similarity DESC, time_modified DESC`.

### Response shape

```json
{
  "results": [
    {
      "note": { "id": 41, "description": "...", "...": "..." },
      "similarity": 0.87
    }
  ]
}
```

| Field        | Meaning                                                        |
| ------------ | -------------------------------------------------------------- |
| `similarity` | Query ↔ note description cosine similarity (used for ranking) |

## Client behavior

### notes-next (web)

`useItemLists` (`src/workspace/`) debounces search input (250 ms) and calls
`POST /api/items/search`. While a query is active, the note list switches from
chronological order to relevance order and shows a similarity percentage badge.
The app can also trigger embedding maintenance from the UI.

## Environment

| Variable       | Required          | Purpose                                             |
| -------------- | ----------------- | --------------------------------------------------- |
| `JINA_API_KEY` | Search, embedding | Jina AI API authentication                          |
| `DB_ITEMS_URL` | Yes (script only) | Postgres connection for `regenerate-embeddings.mjs` |

`JINA_API_KEY` is needed for search and embedding maintenance; saving works without
it. When it is missing or Jina fails, those two routes answer `503` with code
`search_unavailable`.

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
│ Note saved  │ ──embed after response─▶│  Jina AI API │
│ Maintenance │                          └────────────┘
└─────────────┘
```

## Key source files

| Path                                                                | Role                                                      |
| ------------------------------------------------------------------- | --------------------------------------------------------- |
| `lib/db-items/services/item-embeddings.ts`                          | Jina API calls, text normalization, vector generation     |
| `lib/db-items/services/items-app.ts`                                | `embedItemForItemsApp`, search, and embedding maintenance |
| `lib/db-items/sql/item/gets.ts`                                     | Search SQL with pgvector `<=>` ranking                    |
| `lib/db-items/sql/item/update.ts`                                   | Clears the embedding on changed text; embedding UPDATE    |
| `lib/db-items/sql/category.ts`                                      | Category embedding backfill queries                       |
| `lib/db-items/sql/tag.ts`                                           | Tag embedding backfill queries                            |
| `lib/db-items/item-search-constants.ts`                             | `ITEMS_APP_SEARCH_MAX_RESULTS` (20)                       |
| `lib/db-items/migrations/202603151000__note_embeddings.sql`         | `CREATE EXTENSION vector`, initial indexes                |
| `lib/db-items/migrations/202604081200__jina_embeddings_v5_1024.sql` | Jina v5 / 1024-dim migration                              |
| `lib/db-items/scripts/regenerate-embeddings.mjs`                    | Bulk offline regeneration                                 |
| `apps/notes-next/app/api/items/search/route.ts`                     | Next.js search route                                      |
| `apps/notes-next/app/api/items/maintenance/embeddings/route.ts`     | Maintenance route                                         |
| `apps/notes-next/src/workspace/useItemLists.ts`                     | Client search UI and debounce                             |
