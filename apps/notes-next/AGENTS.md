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
      LoginForm.tsx
      NotesHeader.tsx
      FeedbackNotifications.tsx
      FilterBanners.tsx
      NoteResultsList.tsx
      NoteForm.tsx
      modals/
        EditCategoryModal.tsx
        DeleteCategoryModal.tsx
        EditTagModal.tsx
        DeleteTagModal.tsx
    ui/
      icons/                — small inline SVG icons
  hooks/                    — shared React hooks (useSidebarDrawer, useAutoDismissStatus)
  lib/                      — shared utilities (api, dates, strings)
  types/                    — shared types (NoteFormState, EmbeddingMaintenanceMode, ...)
  constants/                — shared constants
```

## File and folder conventions

- **Routes vs. shared code.** `app/` is reserved for Next.js App Router (pages, layouts, API route handlers). All other React components, hooks, utilities, types, and constants belong under `src/`.
- **New pages.** Add new pages as `app/<route>/page.tsx` and keep the bulk of their implementation (components, hooks, utilities) under `src/` so they can be shared. Feature-scoped components live under `src/components/<feature>/`.
- **Component file names use `PascalCase.tsx`** (e.g. `NoteForm.tsx`), matching the exported component. Non-component files (hooks, utilities, types, constants) use `camelCase.ts` or `kebab-case.ts`.
- **Path alias.** `tsconfig.json` maps `@/*` to `./src/*`. Prefer `@/components/...`, `@/lib/...`, etc. over deep relative paths.

## Architecture

- All database access and embedding logic is in `@lib/db-marketing`. API routes call `notesAppService` from `@lib/db-marketing/services/notes-app` — no SQL or Jina calls in this package.
- Use Zustand stores under `src/stores/` for app-wide UI state. Prefer store actions/selectors over passing state and callbacks through multiple component layers.

## Note saving lifecycle

The note editor persists through `saveCurrentNote(mode)` in `NotesApp.tsx`, with three modes:

- `manual` — explicit submit; shows pending UI and resets to a fresh draft.
- `autosave` — trailing debounce (`NOTE_AUTOSAVE_DEBOUNCE_MS`, 3s) while the note stays open. The debounce and `saveCurrentNote` both compare a draft signature against `lastSavedNoteDraftRef`, so an unchanged note never hits the network.
- `flush` — forced save of the *outgoing* note right before the editor is replaced. `saveCurrentNote` snapshots the editor synchronously before any `await`, so a flush captures the note being left, not the one being opened.

Anything that replaces the editor awaits `flushPendingNoteSave()` first: opening another note, starting a new note (header `+`/`jot.new`, cancel button, sidebar `+`), browser back/forward (`popstate`), signing in (`handleLogin`/`handleSocialSignIn`), and sign-out. `pagehide`/`visibilitychange` fire a best-effort `keepalive` request to cover abrupt tab closes inside the debounce window.

## Anonymous → permanent account merge (single load path)

When an anonymous visitor signs in, their visitor data is merged into the real account. To keep this race-free there is exactly **one** writer of post-login session data: the `restoreSession` effect in `NotesApp.tsx`. `handleLogin`/`handleSocialSignIn` only flush, capture a signed merge token while still anonymous (stashed in `sessionStorage` under `notes-pending-merge-token`), and call `signIn`. When `restoreSession` next runs for a real (non-anonymous) session and finds a pending token, it POSTs `/api/anon-session/merge`, then loads the account's data once (skipping the stale cache paint). The login handlers must not load data or run the merge themselves — doing so reintroduces the clobber race.

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
| `MARKETING_DB_URL` | PostgreSQL connection string                                     |
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

- Notes DB migration commands belong in `lib/db-marketing/package.json`, with root-level wrappers in the repo `package.json`.
- For Notes production changes, the normal order is: repo verify, Notes DB migration if needed, then Railway deploy.
- Use `db:verify` deliberately; it is not read-only and is mainly for branch validation and controlled contract checks.

## UI

This web app uses 2 libraries. Whenever developing anything, feel free to use components and utilities from either library, whichever is most appropriate.

- Mantine (@mantine/core) mantine.dev/core
- Gravity (@gravity-ui/uikit) gravity-ui.com/components/uikit

Style: prefer clean and minimal styles. Less padding and margin, no unnecessary borders or embelishments. Try to fill the available width and height of the screen.
