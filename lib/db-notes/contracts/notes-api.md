# Notes API

This document describes the app-facing Notes HTTP API served by
`apps/notes-next` and consumed by both the Notes web UI and the Android client.

## Source Of Truth

- HTTP payload shapes: `contracts/notes-app.ts`
- Generated cross-client contract artifact: `generated/contracts/notes-app.json`
- Shared backend workflows: `services/notes-app.ts`
- HTTP adapters:
  - `apps/notes-next/app/api/**`

## Auth Model

Every data endpoint requires an authenticated identity. There are two ways to
authenticate, and the server derives the acting user id from them — any
`userId` field still present in request bodies or query strings is **ignored**
and overridden server-side:

- **Web UI**: the NextAuth (Auth.js) session cookie, set by signing in on the
  web app (credentials, social provider, or anonymous session).
- **Android / API clients**: a per-user bearer token issued by
  `POST /api/auth/token` and sent as `Authorization: Bearer <token>` on every
  request.

Requests with no valid cookie or token receive:

```json
{
  "error": "Authentication required."
}
```

with status `401`.

Tokens are stored hashed (SHA-256) in `user_api_token_v1`; the plaintext token
is returned exactly once at login. The old passwordless
`POST /api/session { identifier }` login has been removed.

## Endpoints

### `POST /api/auth/token`

Logs in with credentials and issues a bearer token.

Request body:

```json
{
  "identifier": "admin",
  "password": "hunter2"
}
```

Success `200`:

```json
{
  "token": "nta_...",
  "user": {
    "id": 7,
    "username": "admin",
    "email": "admin@example.com",
    "phone": "5550100"
  }
}
```

Invalid credentials `401`:

```json
{
  "error": "Invalid username, email, phone, or password."
}
```

### `DELETE /api/auth/token`

Revokes the bearer token presented in the `Authorization` header (sign out).

Success `200`:

```json
{
  "ok": true
}
```

### `GET /api/session`

Returns the authenticated user. Identity comes from the session cookie or
bearer token; a `userId` query parameter is ignored.

Success `200`:

```json
{
  "user": {
    "id": 7,
    "username": "admin",
    "email": "admin@example.com",
    "phone": "5550100"
  }
}
```

Not found `404`:

```json
{
  "error": "User not found."
}
```

### `GET /api/notes`

Success `200`:

```json
{
  "notes": [
    {
      "id": 41,
      "userId": 7,
      "title": "Ship Notes API tests",
      "summary": "Verify both HTTP adapters",
      "description": "The Next and Express routes should stay behaviorally aligned.",
      "timeDue": "2026-03-18T16:00:00.000Z",
      "timeRemind": "2026-03-18T15:30:00.000Z",
      "timeCreated": "2026-03-17T10:00:00.000Z",
      "timeModified": "2026-03-17T10:05:00.000Z"
    }
  ]
}
```

### `POST /api/notes`

Request body (`userId` is accepted for wire compatibility but ignored; the
server uses the authenticated user):

```json
{
  "userId": 7,
  "note": {
    "title": "Ship Notes API tests",
    "summary": "Verify both HTTP adapters",
    "description": "The Next and Express routes should stay behaviorally aligned.",
    "timeDue": "2026-03-18T16:00:00.000Z",
    "timeRemind": "2026-03-18T15:30:00.000Z"
  }
}
```

Success `201`:

```json
{
  "note": {
    "id": 41,
    "userId": 7,
    "title": "Ship Notes API tests",
    "summary": "Verify both HTTP adapters",
    "description": "The Next and Express routes should stay behaviorally aligned.",
    "timeDue": "2026-03-18T16:00:00.000Z",
    "timeRemind": "2026-03-18T15:30:00.000Z",
    "timeCreated": "2026-03-17T10:00:00.000Z",
    "timeModified": "2026-03-17T10:05:00.000Z"
  }
}
```

### `PATCH /api/notes`

Request body adds `noteId`.

Success `200`: same response shape as `POST /api/notes`.

Not found `404`:

```json
{
  "error": "Note not found."
}
```

### `DELETE /api/notes`

Request body:

```json
{
  "userId": 7,
  "noteId": 41
}
```

Success `200`:

```json
{
  "ok": true
}
```

Not found `404`:

```json
{
  "error": "Note not found."
}
```

### `POST /api/notes/search`

Request body:

```json
{
  "userId": 7,
  "query": "adapter parity",
  "limit": 12
}
```

Success `200`:

```json
{
  "results": [
    {
      "note": {
        "id": 41,
        "userId": 7,
        "title": "Ship Notes API tests",
        "summary": "Verify both HTTP adapters",
        "description": "The Next and Express routes should stay behaviorally aligned.",
        "timeDue": "2026-03-18T16:00:00.000Z",
        "timeRemind": "2026-03-18T15:30:00.000Z",
        "timeCreated": "2026-03-17T10:00:00.000Z",
        "timeModified": "2026-03-17T10:05:00.000Z"
      },
      "similarity": 0.94
    }
  ]
}
```

This endpoint only performs search. It does not repair or backfill note
embeddings. Ranking is cosine similarity between the query embedding and each
note's `description_embedding`.

### `POST /api/notes/maintenance/embeddings`

Request body:

```json
{
  "userId": 7,
  "mode": "missing",
  "limit": 100
}
```

Allowed `mode` values:

- `missing`: repair rows that are missing one or more required embeddings
- `stale`: recompute rows whose stored embedding version/model is outdated,
  including rows that are also missing embeddings

Success `200`:

```json
{
  "mode": "missing",
  "processed": 12,
  "updated": 12,
  "hasMore": false
}
```

## Compatibility Checks

When Notes backend code changes, CI should catch three classes of regression:

1. Contract drift in `@lib/db-notes`
2. HTTP adapter drift between Next and Express
3. Client incompatibility in `notes-next` or `notes-android`

The expected checks are:

- `pnpm --filter @lib/db-notes db:verify`
- `pnpm --filter notes-next test`
- `pnpm --filter notes-next check-types`
- `pnpm --filter notes-next build`
- `pnpm --filter notes-android test`
- `pnpm --filter notes-android build`

## User backup and restore

Both methods use `/api/backup` and the normal authenticated cookie or bearer token.
Client-supplied account ids and identity fields are ignored. Responses use
`Cache-Control: no-store`.

- `GET`: returns a downloadable JSON attachment, named
  `jot-new-backup-YYYY-MM-DD.json`. Anonymous sessions may export.
- `POST`: accepts the **entire backup file** as `application/json` (not wrapped
  in an object or multipart form). The destination must be a permanent account.
  Success `200` returns `{ "notesImported": 12, "notesSkipped": 3 }`.
- Errors: `400` invalid format/version/content/relations, `401` unauthenticated or
  deleted user, `403` anonymous restore target, `413` over 50 MiB, `415` incorrect
  content type, `503` unavailable database, `500` unexpected operation failure.
  Internal SQL and connection details are never returned.

Version 1 is defined by `UserBackup`, `BackupWorkspace`, `BackupVocabulary`,
`BackupStatus`, and `BackupNote` in `notes-app.ts`. Its envelope contains:

```json
{
  "format": "jot.new-user-backup",
  "version": 1,
  "exportedAt": "2026-10-03T12:00:00.000Z",
  "preferences": {},
  "activeWorkspaceLabel": null,
  "workspaces": []
}
```

The envelope example omits workspace contents for brevity; a valid file contains
at least one workspace. Each workspace contains its label, creation/modification
timestamps, categories, statuses (including ordering), tags, and notes. Note
relationships use workspace-local labels, not database ids. Notes carry nullable
text, due/reminder dates, and original creation/modification timestamps. Unused
vocabulary and empty workspaces are included. The active workspace preference is
remapped by label into the destination account. Other preference keys are retained
for forward compatibility; unsafe object keys and excessive nesting are rejected.

The backup excludes authentication credentials/tokens, account identifiers/contact
information, generated vectors, and browser-only editor/cache state. The web UI
flushes saveable drafts and preferences before exporting. Restore has no Jina
dependency; the existing `missing` embedding maintenance endpoint rebuilds search
vectors afterward. Unknown backup versions are rejected rather than guessed.

Export uses a repeatable-read, read-only transaction so every query sees one
consistent snapshot. Restore validates the complete file, stages an anonymous
source, calls the transaction-scoped anonymous merge, and removes that source,
all on one PostgreSQL client within one transaction. It locks the destination
user to serialize competing imports. A failure rolls back staging and merging.

Merge rules: matching workspace/vocabulary labels combine; existing destination
vocabulary metadata/ordering wins on collisions; distinct workspaces/vocabulary
retain original timestamps; destination notes are never overwritten or deleted;
backup preference leaves win, and account-only keys survive. Exact note copies
match by creation time, description, due/reminder dates, status, and category/tag
labels. Modified time does not force duplication of otherwise identical content.
Copy counts preserve identical twin notes while repeated imports remain stable.
Changed versions are added alongside existing notes. Uploads are bounded by actual
streamed bytes as well as declared length and by 100,000 aggregate records; export
refuses files that could not subsequently be restored under these limits.

## Android Base URLs

The Android APK talks to a deployed `notes-next` over HTTPS. It does not read
`DB_NOTES_URL` or `JINA_API_KEY`; those only affect the `notes-next` server
that the APK calls.

- Production `notes-next`: `https://notes-apps-notes-next.up.railway.app`
- Dev `notes-next`: `https://notes-apps-notes-next-dev.up.railway.app`
- The target environment must be specified at build time. Use
  `pnpm --filter notes-android build:dist:dev` or `build:dist:prod`; there is
  no ambiguous bare `build:dist` script.
- For a custom URL (staging, local), pass `NOTES_ANDROID_API_BASE_URL` inline:
  `NOTES_ANDROID_API_BASE_URL=https://... pnpm --filter notes-android build:dist:dev`.
