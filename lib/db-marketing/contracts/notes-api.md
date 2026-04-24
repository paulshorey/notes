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

This API is still prototype-only:

- `POST /api/session` looks up an existing user by username, email, or phone
- there is no password, token, or server-side session yet
- follow-up requests send `userId`

Do not treat this as production-grade authentication.

## Endpoints

### `POST /api/session`

Request body:

```json
{
  "identifier": "admin"
}
```

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
  "error": "No matching user was found. Enter an existing username, email, or phone number."
}
```

### `GET /api/session?userId=<id>`

Success `200`: same body as `POST /api/session`.

Not found `404`:

```json
{
  "error": "User not found."
}
```

### `GET /api/notes?userId=<id>`

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

Request body:

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
      "similarity": 0.94,
      "titleSimilarity": 0.91,
      "summarySimilarity": 0.89,
      "descriptionSimilarity": 0.85
    }
  ]
}
```

This endpoint only performs search. It does not repair or backfill note
embeddings.

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

1. Contract drift in `@lib/db-marketing`
2. HTTP adapter drift between Next and Express
3. Client incompatibility in `notes-next` or `notes-android`

The expected checks are:

- `pnpm --filter @lib/db-marketing db:verify`
- `pnpm --filter notes-next test`
- `pnpm --filter notes-next check-types`
- `pnpm --filter notes-next build`
- `pnpm --filter notes-android test`
- `pnpm --filter notes-android build`

## Android Base URLs

The Android APK talks to a deployed `notes-next` over HTTPS. It does not read
`MARKETING_DB_URL` or `JINA_API_KEY`; those only affect the `notes-next` server
that the APK calls.

- Production `notes-next`: `https://marketing-apps-notes-next.up.railway.app`
- Dev `notes-next`: `https://marketing-apps-notes-next-dev.up.railway.app`
- The target environment must be specified at build time. Use
  `pnpm --filter notes-android build:dist:dev` or `build:dist:prod`; there is
  no ambiguous bare `build:dist` script.
- For a custom URL (staging, local), pass `NOTES_ANDROID_API_BASE_URL` inline:
  `NOTES_ANDROID_API_BASE_URL=https://... pnpm --filter notes-android build:dist:dev`.
