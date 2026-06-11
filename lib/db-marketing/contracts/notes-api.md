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
