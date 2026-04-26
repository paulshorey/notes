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
      notes-app-route-handlers.ts   — shared route handler factories
    session/                — GET (lookup by userId), POST (login by identifier)
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
- UI uses **Gravity UI** (`@gravity-ui/uikit`) and **Mantine** (`@mantine/core`). No Tailwind. See the Gravity UI agent skills in `.claude/skills/`, and the "UI" section below for when to use which.
- Routes are wired through `app/api/_lib/notes-app-route-handlers.ts` which maps service calls to HTTP responses and translates embedding errors to correct status codes.
- This package validates Notes contracts, but it does not own Notes migration scripts.

## Embedding debug page

`/embeddings` (`app/embeddings/page.tsx`) — calls `POST /api/embeddings/debug`.

- Select **Search task** (default: `retrieval.query`) and **Passage task** (default: `retrieval.passage`) to control the Jina `task` parameter sent for each embedding call.
- These defaults match what the production app uses. Select `(none)` to omit `task` entirely and observe baseline behavior.
- The debug route is standalone — it does not use `notesAppService` or write to the DB.

## Environment variables

| Variable | Purpose |
|----------|---------|
| `MARKETING_DB_URL` | PostgreSQL connection string |
| `JINA_API_KEY` | Jina AI embeddings key (semantic search + embedding maintenance) |

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

Mantine is preferred.

- Mantine (@mantine/core) mantine.dev/core
- Gravity (@gravity-ui/uikit) gravity-ui.com/components/uikit

Style: prefer clean and minimal styles. Less padding and margin, no unnecessary borders or embelishments. Try to fill the available width and height of the screen.
