# `data`

Networking and persistence layer for the Android Notes app.

## Files

- `NotesApiClient.kt` - OkHttp client for the deployed `notes-next` REST API (`/api/session`, `/api/notes`, `/api/tags`, `/api/notes/search`).
- `NotesRepository.kt` - orchestration layer that reads/writes `AppSnapshot`, calls the API client, persists errors, updates the widget, and schedules/cancels background refresh.
- `SessionStore.kt` - DataStore-backed persistence for the durable app snapshot.
- `JsonCodec.kt` - JSON serialization helpers for snapshot storage and API payload decoding.

## Core concepts

- `AppSnapshot` in `SessionStore` is the canonical persisted app state for the client.
- `NotesRepository.persist(...)` always calls `NotesHomeWidget().updateAll(...)`, so repository writes immediately refresh placed widgets.
- Widget-only UI state is **not** stored here; expand/collapse plus widget category/tag filtering live in Glance preferences inside `widget/`.
- `BuildConfig.DEFAULT_API_BASE_URL` is the only base URL the repository uses; it comes from Gradle config, not runtime user input.

## Non-obvious rules

- `tools/validate-marketing-contract.mjs` validates `Models.kt`, `JsonCodec.kt`, and `NotesApiClient.kt` against `@lib/db-marketing/generated/contracts/notes-app.json`.
- Keep data-class field order and JSON binding structure stable when changing models; the validator is intentionally strict.
- `restoreSession(refreshSearch = true)` re-runs semantic search only when `lastSearchQuery` is non-blank.
- The Android app never talks to Postgres directly. If an API shape changes, update `@lib/db-marketing` and the server-side route implementation first.

## Maintenance

Keep this file up to date after major changes in `data/`. Edit it when API endpoints, persistence flow, snapshot ownership, or contract-validation rules change.
