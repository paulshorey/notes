# Semantic Search & Vector Embeddings

This document explains how vector-based semantic search works across the Notes
apps (`notes-next`, `notes-android`) and the shared database layer
(`@lib/db-marketing`).

## Overview

Every note is embedded into a set of 1024-dimensional vectors using the
Jina AI Embeddings API (`jina-embeddings-v5-text-small`). When a user
searches, the query text is also embedded with the same model. The database
ranks notes by cosine similarity between the query vector and each note's
stored vectors.

Jina v5 supports **task-specific LoRA adapters** that significantly improve
search quality, especially for short phrases:

- **`retrieval.passage`** — used when storing note content and category labels
- **`retrieval.query`** — used when embedding the user's search query

This asymmetric approach means the model understands the difference between
"a document about X" and "a query looking for X", producing much better
similarity rankings than a single symmetric embedding.

## Embedding model

| Setting    | Value                                      |
|------------|--------------------------------------------|
| Provider   | Jina AI (`/v1/embeddings`)                 |
| Model      | `jina-embeddings-v5-text-small`            |
| Dimensions | 1024                                       |
| Normalized | `true` (L2 normalized for cosine via dot)  |
| Timeout    | 30 seconds                                 |

The model identifier stored alongside each note is
`jina-embeddings-v5-text-small:notes-v3`. This tag lets the maintenance
endpoint detect notes that were embedded with an older model version so they
can be re-embedded.

### Task types

| Task               | Used for                              |
|--------------------|---------------------------------------|
| `retrieval.passage`| Storing note descriptions, content, category labels |
| `retrieval.query`  | Embedding user search queries         |
| `text-matching`    | Symmetric similarity (not used yet)   |

## Database schema

The `user_note_v1` table stores one embedding column (`vector(1024)`):

| Column                  | Source text        |
|-------------------------|--------------------|
| `description_embedding` | `description` only |

The `user_note_category_v1` table stores one embedding column:

| Column               | Source text       |
|----------------------|-------------------|
| `category_embedding` | `label` only      |

Additional metadata columns (on both tables):

- `embedding_model` — records which model version produced the vectors
- `embedding_updated_at` — timestamp of the last embedding write

Each embedding column has an HNSW index using `vector_cosine_ops` for
approximate nearest-neighbor search.

### Why a combined `content_embedding`?

A single embedding that captures the full note gives the best relevance for
queries that match the overall idea of a note rather than one specific
field. Per-column embeddings complement this by boosting notes where a
particular field aligns strongly with the query.

## Embedding lifecycle

### On note create / update

`services/notes-app.ts` calls `createNoteEmbeddingInput(note)` before
writing to the database. This function:

1. Normalizes each text field (trim whitespace, normalize line endings).
2. Builds the combined content string from all non-empty fields.
3. Collects the individual non-empty field texts.
4. Sends all texts to Jina with `task: "retrieval.passage"` in a single batch.
5. Returns a `NoteEmbeddingWriteInput` with JSON-serialized vector literals
   for each column, or `null` for fields that had no text.

The INSERT / UPDATE queries cast these values to `::vector` and write them
alongside the note content.

### On search (backfill)

Before executing a search, the service checks for notes belonging to the
user that are missing any embedding column they should have. If any are
found, they are backfilled in a batch before the query runs. This
ensures newly imported or legacy notes are searchable immediately.

### Maintenance endpoint

`POST /api/notes/maintenance/embeddings` supports two modes:

| Mode      | Behavior                                                          |
|-----------|-------------------------------------------------------------------|
| `missing` | Re-embed notes that have at least one expected embedding column as NULL |
| `stale`   | Re-embed notes whose `embedding_model` differs from the current version, or that are missing any column |

Request body:

```json
{
  "userId": 7,
  "mode": "missing",
  "limit": 25
}
```

Response:

```json
{
  "mode": "missing",
  "processed": 10,
  "updated": 10,
  "hasMore": false
}
```

Call this endpoint in a loop (incrementing until `hasMore` is `false`) to
backfill or upgrade all notes for a user.

## Query-time search

### API endpoint

`POST /api/notes/search`

Request body:

```json
{
  "userId": 7,
  "query": "grocery shopping list",
  "limit": 12
}
```

### How the query is processed

1. The query string is normalized and sent to Jina with
   `task: "retrieval.query"` to produce a single 1024-dimension embedding.
2. The database computes cosine similarity (`1 - (embedding <=> query)`)
   between the query vector and each note's embedding columns.
3. A composite score is calculated and results are sorted by descending
   similarity.

### Ranking formula

```
score = description_similarity * 0.67 + avg_category_similarity * 0.33
```

- Description similarity is the primary signal (67% weight).
- All linked categories contribute equally via their average (33% weight).

When `description_embedding` is `NULL`, its contribution is zero.
When no categories have embeddings, the category contribution is zero.

**Ordering:** Results are ordered by `semantic_similarity DESC, time_modified DESC`
and limited by the requested `limit` (1–25, default 12).

### Response shape

```json
{
  "results": [
    {
      "note": { "id": 41, "description": "...", "..." : "..." },
      "similarity": 0.87,
      "categorySimilarity": 0.79,
      "descriptionSimilarity": 0.82
    }
  ]
}
```

The `similarity` field is the composite score. The per-column values are
exposed for debugging and UI display but are not used for ordering.

## Client behavior

### notes-next (web)

The main page has a search input above the notes list. As the user types,
the client debounces input (250 ms) and fires a `POST /api/notes/search`
request. While a search query is active, the note list switches from
chronological order to relevance order and shows a similarity percentage
badge on each row.

### notes-android

The Android client calls the same `POST /api/notes/search` endpoint via its
companion Express server, which delegates to the same shared service layer
in `@lib/db-marketing`. The ranking logic is identical.

## Key source files

| Path | Role |
|------|------|
| `lib/db-marketing/services/notes-embeddings.ts` | Jina API calls, text normalization, vector generation |
| `lib/db-marketing/services/notes-app.ts` | Orchestrates embed-then-write for CRUD + search workflow |
| `lib/db-marketing/sql/note/gets.ts` | Search SQL with ranking, backfill queries |
| `lib/db-marketing/sql/note/add.ts` | INSERT with embedding columns |
| `lib/db-marketing/sql/note/update.ts` | UPDATE with embedding columns, backfill UPDATE |
| `lib/db-marketing/sql/note/types.ts` | `NoteEmbeddingWriteInput` type |
| `lib/db-marketing/contracts/notes-app.ts` | `SearchRequest`, `SearchResponse`, `SemanticSearchResult` types |
| `apps/notes-next/app/api/notes/search/route.ts` | Next.js route handler |
| `apps/notes-next/app/api/notes/maintenance/embeddings/route.ts` | Maintenance route handler |
| `apps/notes-next/app/notes-app.tsx` | Client-side search UI and debounce logic |

## Environment

The `JINA_API_KEY` environment variable must be set on the server. If it
is missing, search and note creation/update return a `500` error with the
message "JINA_API_KEY environment variable not set."
