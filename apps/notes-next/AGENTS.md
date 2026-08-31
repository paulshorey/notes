# `notes-next`

Next.js 16 web app for the Notes product. Serves both the React UI and the REST API consumed by the Android client. This package is deployed to Railway.

## Key directories

```
app/                        — Next.js App Router: pages, layouts, API routes only
  page.tsx                  — renders <NotesApp /> from src/
  layout.tsx                — root layout with ThemeProvider (Gravity UI) + MantineProvider
  providers.tsx             — client-side providers
  globals.css
  embeddings/               — debug page for testing Jina embeddings
  search/                   — legacy redirect -> /
  api/
    _lib/
      notes-app-route-handlers.ts   — shared route handler factories (auth-bound)
      authenticated-user.ts         — maps the NextAuth session cookie to a Notes user id
    auth/
      [...nextauth]/        — Auth.js (NextAuth) sign-in routes for the web UI
      token/                — POST (credentials -> bearer token, used by Android), DELETE (revoke)
    anon-session/
      merge-token/          — POST (anonymous session mints a signed merge token)
      merge/                — POST (real session merges anonymous data using the token)
      claim/                — POST (anonymous session upgrades itself into a permanent account in place)
    session/                — GET (authenticated user), PATCH (preferences)
    notes/                  — GET (list), POST (create), PATCH (update), DELETE
    tags/                   — GET (list), POST (create)
    categories/             — GET (list), POST (create), PATCH, DELETE
    notes/search/           — POST (semantic search)
    notes/maintenance/
      embeddings/           — POST (backfill/repair missing or stale embeddings)
    embeddings/
      debug/                — POST (standalone Jina debug route for /embeddings page)
    health/                 — GET (liveness probe)

src/                        — non-route code (import with "@/..." alias)
  components/
    notes/                  — notes-feature UI (NotesApp and sub-components)
      NotesApp.tsx          — top-level notes page container
      NotesApp.module.css   — shared notes CSS module
      NotesHeader.tsx       — app-wide header (logo, search, back, recent notes, user menu)
      FeedbackNotifications.tsx
      ResultsColumn.tsx     — notes sidebar (categories, tags, note actions)
      NoteResultsList.tsx
      NoteForm.tsx
      modals/
        EditCategoryModal.tsx
        DeleteCategoryModal.tsx
        EditTagModal.tsx
        DeleteTagModal.tsx
    ui/
      icons/                — small inline SVG icons
  hooks/                    — shared React hooks (useSidebarDrawer, useAutoDismissStatus,
                              useOpenNotesAutosave)
  lib/                      — shared utilities (api, dates, strings, noteDraft,
                              notesCache, openNotesStorage)
  stores/                   — Zustand store (notesAppStore) and the pure open-note ring
                              reducers (openNotes)
  types/                    — shared types (NoteFormState, EmbeddingMaintenanceMode, ...)
  constants/                — shared constants
```

## File and folder conventions

- **Routes vs. shared code.** `app/` is reserved for Next.js App Router (pages, layouts, API route handlers). All other React components, hooks, utilities, types, and constants belong under `src/`.
- **New pages.** Add new pages as `app/<route>/page.tsx` and keep the bulk of their implementation (components, hooks, utilities) under `src/` so they can be shared. Feature-scoped components live under `src/components/<feature>/`.
- **Component file names use `PascalCase.tsx`** (e.g. `NoteForm.tsx`), matching the exported component. Non-component files (hooks, utilities, types, constants) use `camelCase.ts` or `kebab-case.ts`.
- **Path alias.** `tsconfig.json` maps `@/*` to `./src/*`. Prefer `@/components/...`, `@/lib/...`, etc. over deep relative paths.

## Architecture

- All database access and embedding logic is in `@lib/db-notes`. API routes call `notesAppService` from `@lib/db-notes/services/notes-app` — no SQL or Jina calls in this package.
- Use Zustand stores under `src/stores/` for app-wide UI state. Prefer store actions/selectors over passing state and callbacks through multiple component layers.

## Note saving lifecycle

Several notes are open at once, in a bounded most-recently-used **ring**. Opening a note adds an entry rather than replacing one, so switching never waits for a save.

- `src/stores/openNotes.ts` — pure, React-free reducers over the ring. The open sequence is **insert → activate → evict**, and the order is load-bearing: eviction protects the active entry, so evicting first protects the *outgoing* note and at a cap of 1 leaves nothing droppable. There is a unit test pinned at `cap === 1`; larger caps hide the bug.
- `src/lib/openNotesStorage.ts` — persists the ring under its own key, `notes-open-notes-v1`. Deliberately **not** part of `notesCache`, which expires after 14 days and is wiped on session-restore failure; either would destroy unsaved text. `reconcileOpenNotes` is pure and takes a lookup rather than the note array.
- `src/hooks/useOpenNotesAutosave.ts` — one debounce per dirty entry, re-armed only when that entry's own signature changes so typing in one note cannot starve a background save.

The editor has **no submit control** — notes only ever save in the background. `NoteForm`'s `<form>` exists for grouping and styling; its `onSubmit` only calls `preventDefault()` so Enter in an expanded date field cannot implicitly submit and reload the page. Do not reintroduce a save mode that resets the editor after saving: it would recycle the ring slot holding the just-saved note, and throw away anything typed while the request was in flight.

Notes persist through `saveEntry(key, mode)` in `NotesApp.tsx`, keyed by entry:

- `autosave` — trailing debounce (`NOTE_AUTOSAVE_DEBOUNCE_MS`, 3s). Saves for different entries run concurrently; a second save of the *same* entry queues behind the first.
- `flush` — awaited save, used only where the session itself changes (`handleLogin`, `handleSignup`, `handleLogout`) via `flushAllPendingSaves()`. Ordinary note switching no longer flushes.
- `detached` — an entry that left the ring by eviction, explicit close, or a lowered cap, but was still dirty. Its snapshot moves to `detachedSaves` so the request still lands; closing a note is never discarding it. A detached save waits on any in-flight save for the same key and is never retried, because a repeated `POST` for a never-saved draft would create a second note.

`pagehide`/`visibilitychange` fire best-effort `keepalive` requests for every dirty entry **and** everything in `detachedSaves`, and write the persistence snapshot.

**Invariant worth protecting:** a form change the *user* did not make must never leave an entry dirty. Reconciliation, the category remap, and the sidebar move handlers all recompute `savedSignature` alongside the form — otherwise autosave immediately pushes the change back to the server, which on the anonymous-merge path would overwrite merged category and tag ids with anonymous-side ones.

**Async handlers must capture the entry key before awaiting.** `handleCreateTag` and `handleCreateCategory` take a `targetKey`; without it a tag created in one note lands in whichever note is active when the response returns.

## Store selectors

Selectors passed to `useNotesAppStore` must return an existing reference or a primitive. One that builds a new object or array each call hands `useSyncExternalStore` a fresh snapshot on every render and hangs the app in an infinite loop. Derive that kind of value with `useMemo` in the component instead.

## User preferences

`notesApp.*` in `user_v1.preferences` (JSONB). Adding a key means editing `NotesAppPreferences` in `lib/db-notes/contracts/notes-app.ts` and regenerating `generated/contracts/notes-app.json` with `pnpm --filter @lib/db-notes app:contract:generate` — `app:contract:check` gates both `check-types` and `build`. No migration is needed, and the Android contract validator only checks `UserSummary`, `TagRecord`, `NoteRecord`, and `SemanticSearchResult`, so an added optional preference does not affect the APK.

Writes go through a 500ms debounced `PATCH /api/session`. Its response must also call `updateNotesCacheUser`, and the background session refresh only keeps the in-memory copy when there is genuinely an unsaved edit — otherwise a changed preference takes two reloads to appear, because the next launch paints from the cached snapshot.

## Anonymous → permanent account (claim or merge, single load path)

Anonymous visitors are real `user_v1` rows (`is_anonymous = true`). Two ways they become permanent, both credentials-based (OAuth login was removed as unfinished):

Anonymous users see a sign-in / create-account toggle in the header popup
(`NotesHeader.tsx`). Mode-switch buttons use `type="button"` so they never
submit the form; the popup closes only after a successful login or signup.

- **Create account (common path, claim-in-place):** `handleSignup` flushes pending saves, POSTs `/api/anon-session/claim` (which sets username/email/hashed password and flips `is_anonymous` on the *same* row), then re-runs `signIn("credentials")` for the same user id so the JWT's `isAnonymous` flips. No data moves between users, no merge token exists in this path.
- **Sign in to an existing account (merge path):** to keep this race-free there is exactly **one** writer of post-login session data: the `restoreSession` effect in `NotesApp.tsx`. `handleLogin` only flushes, captures a signed merge token while still anonymous (stashed in `sessionStorage` under `notes-pending-merge-token`), and calls `signIn`. When `restoreSession` next runs for a real (non-anonymous) session and finds a pending token, it POSTs `/api/anon-session/merge`, then loads the account's data once (skipping the stale cache paint). The login handlers must not load data or run the merge themselves — doing so reintroduces the clobber race.

Merge failure handling (no silent loss): if merge-token capture fails in `handleLogin` while the visitor has notes, the sign-in is aborted with an error so the user retries while still anonymous. If the merge POST itself fails transiently (network/5xx), `restoreSession` re-stashes the token so a page reload retries within the token's 10-minute TTL; a 4xx is permanent (token/anon row invalid) and only shows a warning. Server-side, the merge also carries the visitor's explicitly-set preferences into the real account (per-property, anon wins) and backfills missing category/tag embeddings best-effort — see `lib/db-notes`.

`noteSaveStatus` in `notesAppStore` (`idle | unsaved | saving | saved | error`) drives the header save indicator (`SaveStatusIndicator` in `NotesHeader.tsx`). The save routine owns the status while a request is in flight; otherwise an effect derives it from the draft signature.
- UI uses **Gravity UI** (`@gravity-ui/uikit`) and **Mantine** (`@mantine/core`). No Tailwind. See the Gravity UI agent skills in `.claude/skills/`, and the "UI" section below for when to use which.
- Routes are wired through `app/api/_lib/notes-app-route-handlers.ts` which maps service calls to HTTP responses and translates embedding errors to correct status codes.
- **API auth**: every data route derives the acting user server-side — from the NextAuth session cookie (web) or an `Authorization: Bearer <token>` header (Android, tokens issued by `POST /api/auth/token`). Client-supplied `userId` values are ignored; unauthenticated requests get `401`. Route files pass `resolveSessionUserId` from `_lib/authenticated-user.ts` into the handler factories; tests omit it and authenticate with bearer tokens against the fake service.
- This package validates Notes contracts, but it does not own Notes migration scripts.

## Embedding debug page

`/embeddings` (`app/embeddings/page.tsx`) — calls `POST /api/embeddings/debug`.

- Select **Search task** (default: `retrieval.query`) and **Passage task** (default: `retrieval.passage`) to control the Jina `task` parameter sent for each embedding call.
- These defaults match what the production app uses. Select `(none)` to omit `task` entirely and observe baseline behavior.
- The debug route is standalone — it does not use `notesAppService` or write to the DB.

## Environment variables

| Variable           | Purpose                                                          |
| ------------------ | ---------------------------------------------------------------- |
| `DB_NOTES_URL` | PostgreSQL connection string                                     |
| `JINA_API_KEY`     | Jina AI embeddings key (semantic search + embedding maintenance) |

## Build and dev

```bash
pnpm --filter notes-next dev          # http://localhost:3000
pnpm --filter notes-next build
pnpm --filter notes-next check-types
pnpm --filter notes-next verify
```

## Build config notes

- This app uses `next.config.mjs`, not `next.config.ts`.
- On Next.js 16, production builds run with Turbopack by default, so keep the `turbopack.resolveAlias` config aligned with any browser-only webpack fallbacks such as the `fs` stub.

## Testing

```bash
pnpm --filter notes-next test
```

## Release rules

- Notes DB migration commands belong in `lib/db-notes/package.json`, with root-level wrappers in the repo `package.json`.
- For Notes production changes, the normal order is: repo verify, Notes DB migration if needed, then Railway deploy.
- Use `db:verify` deliberately; it is not read-only and is mainly for branch validation and controlled contract checks.

## UI

This web app uses 2 libraries. Whenever developing anything, feel free to use components and utilities from either library, whichever is most appropriate.

- Mantine (@mantine/core) mantine.dev/core
- Gravity (@gravity-ui/uikit) gravity-ui.com/components/uikit

Style: prefer clean and minimal styles. Less padding and margin, no unnecessary borders or embelishments. Try to fill the available width and height of the screen.
