# `notes-next`

Next.js 16 web app for the Notes product. Serves the React UI and the REST API. This package is deployed to Railway.

## Key directories

```
app/                        — Next.js App Router: pages, layouts, API routes only
  page.tsx                  — renders <ItemsApp /> from src/
  layout.tsx                — root layout with ThemeProvider (Gravity UI) + MantineProvider
  providers.tsx             — client-side providers
  globals.css
  embeddings/               — debug page for testing Jina embeddings
  search/                   — legacy redirect -> /
  api/
    _lib/
      items-app-route-handlers.ts   — shared route handler factories (auth-bound)
      authenticated-user.ts         — maps the NextAuth session cookie to an item-service user id
    auth/
      [...nextauth]/        — Auth.js (NextAuth) sign-in routes for the web UI
      token/                — POST (credentials -> bearer token for API clients), DELETE (revoke)
    anon-session/
      merge-token/          — POST (anonymous session mints a signed merge token)
      merge/                — POST (real session merges anonymous data using the token)
      claim/                — POST (anonymous session upgrades itself into a permanent account in place)
    bootstrap/              — GET (user/workspaces + one workspace snapshot for startup/switching)
    backup/                 — GET (JSON download), POST (validated atomic merge into permanent account)
    session/                — GET (authenticated user), PATCH (preferences)
    items/                  — GET (list), POST (create), PATCH (update), DELETE
    notes/                  — legacy payload facade over the item routes
    tags/                   — GET (list), POST (create)
    categories/             — GET (list), POST (create), PATCH, DELETE
    statuses/               — workspace-scoped GET/POST/PATCH/DELETE
    workspaces/             — user-scoped GET/POST/PATCH/DELETE
    items/search/           — POST (semantic search)
    items/maintenance/
      embeddings/           — POST (backfill/repair missing or stale embeddings)
    embeddings/
      debug/                — POST (standalone Jina debug route for /embeddings page)
    health/                 — GET (liveness probe)

src/                        — non-route code (import with "@/..." alias)
  components/
    items/                  — text-focused Notes UI (ItemsApp and sub-components)
      ItemsApp.tsx          — top-level notes page container
      ItemsApp.module.css   — shared notes CSS module
      WorkspaceHeader.tsx       — app-wide header (logo, save status, recent notes, user menu, sidebar toggle)
      FeedbackNotifications.tsx
      ResultsColumn.tsx     — notes sidebar (categories, tags, note actions)
      ItemResultsList.tsx
      TextCaptureForm.tsx
      modals/
        ItemGroupActionModal.tsx
        EditTagModal.tsx
        DeleteTagModal.tsx
    ui/
      icons/                — small inline SVG icons
  hooks/                    — shared React hooks (useSidebarDrawer, useAutoDismissStatus,
                              useOpenItemsAutosave)
  lib/                      — shared utilities (api, dates, strings, itemDraft,
                              itemsCache, openItemsStorage)
  stores/                   — Zustand store (itemsAppStore) and the pure open-item ring
                              reducers (openItems)
  types/                    — shared types (TextCaptureFormState, EmbeddingMaintenanceMode, ...)
  constants/                — shared constants
```

## File and folder conventions

- **Routes vs. shared code.** `app/` is reserved for Next.js App Router (pages, layouts, API route handlers). All other React components, hooks, utilities, types, and constants belong under `src/`.
- **New pages.** Add new pages as `app/<route>/page.tsx` and keep the bulk of their implementation (components, hooks, utilities) under `src/` so they can be shared. Feature-scoped components live under `src/components/<feature>/`.
- **Component file names use `PascalCase.tsx`** (e.g. `TextCaptureForm.tsx`), matching the exported component. Non-component files (hooks, utilities, types, constants) use `camelCase.ts` or `kebab-case.ts`.
- **Path alias.** `tsconfig.json` maps `@/*` to `./src/*`. Prefer `@/components/...`, `@/lib/...`, etc. over deep relative paths.

## Architecture

- All database access and embedding logic is in `@lib/db-items`. API routes call `itemsAppService` from `@lib/db-items/services/items-app` — no SQL or Jina calls in this package.
- Use Zustand stores under `src/stores/` for app-wide UI state. Prefer store actions/selectors over passing state and callbacks through multiple component layers.

Navigation stays on the right at every screen size: up to 720px it is a collapsed
right drawer toggled by the top-right header button; above 720px it is a visible,
resizable right column. There is no bottom trigger or swipe gesture.
`useSidebarDrawer` synchronizes the store when crossing this boundary and preserves
visibility when resizing within a layout. Keep `SIDEBAR_OVERLAY_MEDIA_QUERY` in
`src/constants/items.ts` aligned with the notes CSS modules.

## Startup and service worker

The root layout reads Auth.js once and seeds `SessionProvider`, so returning users do not need a client-side session round trip before startup. `ItemsApp` then calls `GET /api/bootstrap`, which authenticates once and loads the session, notes, categories, and tags in parallel. Keep this as the single cold-start data path; separate startup requests add auth and database work and can race one another.

Every note belongs to exactly one active workspace, has zero or more category links and multiple tags, and may have one status. Category/status/tag ids must come from that same workspace. New notes start without categories unless an action explicitly specifies one. The category trigger shows only its folder icon for an empty selection. The sidebar groups zero-category notes under the display-only `uncategorized` label; this is never a category record. All real categories, including the last one, can be deleted. Reserve the normalized category name `uncategorized` through `@lib/db-items/contracts/category-name` in both UI and service writes. Switching workspaces flushes dirty entries before loading the destination; failed saves keep the current workspace active.

`src/lib/itemGroups.ts` builds one sidebar list containing real categories and the
computed `uncategorized` group. Sort every group by its newest visible note's
`timeModified`, with notes newest first inside it; apply tag filtering before
building groups. Never append `uncategorized` after sorting. Stable group keys
preserve expansion and note actions when saved edits reorder the list. Hide the
computed group when empty, and keep empty real categories after groups with notes.

Category and uncategorized group menus use `ItemGroupActionModal` and the shared
`/api/item-groups` preview/action API. Group actions cover the whole workspace
group, independent of tag/search filters, including non-text items disclosed in
the server preview. Uncategorized rename assigns its current members to a new or
existing category; it never changes future capture defaults. Regular deletion
offers keep-items (preserve other memberships) or permanent deletion everywhere.
Opening the dialog pauses autosave/exit PATCHes, settles saved entries before
preview, and excludes unsaved drafts. Apply the committed response to entries and
caches before refreshing; deleted entries must never become detached saves.
A conflict or uncertain response requires a fresh preview and confirmation.

The local server-data snapshot may paint immediately for a returning user, but a failed refresh must not clear workspace-scoped open-note storage or other draft state. A first visit with no usable snapshot must finish in a visible, retryable error state; startup must never retry automatically in a loop.

A confirmed bootstrap `401` ends the expired Auth.js session on both cached and uncached startup, then uses the normal single visitor-session attempt. Persist open-note drafts before resetting session state; network errors and `5xx` must never trigger logout. Bootstrap must confirm the user still exists before loading workspaces, because workspace loading can insert defaults.

`public/sw.js` caches install icons only. It must never intercept navigation, `/api/*`, or `/_next/*`: HTML and Next.js build output from different deployments are incompatible. Localhost registrations and `notes-pwa-*` caches are removed by `ServiceWorkerRegistration`; `/sw.js` itself is always served with no-cache headers so deployed workers update promptly.

## Note saving lifecycle

Several notes are open at once, in a bounded most-recently-used **ring**. Opening a note adds an entry rather than replacing one, so switching never waits for a save.

- `src/stores/openItems.ts` — pure, React-free reducers over the ring. The open sequence is **insert → activate → evict**, and the order is load-bearing: eviction protects the active entry, so evicting first protects the _outgoing_ note and at a cap of 1 leaves nothing droppable. There is a unit test pinned at `cap === 1`; larger caps hide the bug.
- `src/lib/openItemsStorage.ts` — persists a separate ring per `(userId, workspaceId)` and upgrades the legacy `notes-open-notes-v1` and scoped `notes-open-notes-v2` shapes. It is deliberately **not** part of `itemsCache`, which expires after 14 days and contains only replaceable server data. A transient session-restore failure must not wipe either cache; it would remove the offline view and could destroy unsaved text. `reconcileOpenItems` is pure and takes a lookup rather than the note array.
- `src/hooks/useOpenItemsAutosave.ts` — one debounce per dirty entry, re-armed only when that entry's own signature changes so typing in one note cannot starve a background save.

The editor has **no submit control** — notes only ever save in the background. `TextCaptureForm`'s `<form>` exists for grouping and styling; its `onSubmit` only calls `preventDefault()` so Enter in an expanded date field cannot implicitly submit and reload the page. Do not reintroduce a save mode that resets the editor after saving: it would recycle the ring slot holding the just-saved note, and throw away anything typed while the request was in flight.

Notes persist through `saveEntry(key, mode)` in `ItemsApp.tsx`, keyed by entry:

- `autosave` — trailing debounce (`ITEM_AUTOSAVE_DEBOUNCE_MS`, 3s). Saves for different entries run concurrently; a second save of the _same_ entry queues behind the first.
- `flush` — awaited save, used only where the session itself changes (`handleLogin`, `handleSignup`, `handleLogout`) via `flushAllPendingSaves()`. Ordinary note switching no longer flushes.
- `detached` — an entry that left the ring by eviction, explicit close, or a lowered cap, but was still dirty. Its snapshot moves to `detachedSaves` so the request still lands; closing a note is never discarding it. A detached save waits on any in-flight save for the same key and is never retried, because a repeated `POST` for a never-saved draft would create a second note.

`pagehide`/`visibilitychange` write the persistence snapshot **first**, while entries are still dirty and including anything in `detachedSaves`. That snapshot is the durable recovery if keepalive bodies are dropped (browsers share a bounded in-flight quota). Keepalive then PATCHes already-saved notes only — a keepalive POST of a never-saved draft would race a reload into a second create. `visibilitychange` then `pagehide` share a sent-keys set so the same PATCH is not fired twice.

**Invariant worth protecting:** a form change the _user_ did not make must never leave an entry dirty. Reconciliation and category/tag repair recompute `savedSignature` alongside the form — otherwise autosave immediately pushes the change back to the server.

**Async handlers must capture the entry key before awaiting.** `handleCreateTag`, `handleCreateCategory`, and `handleCreateStatus` take a `targetKey`; without it a taxonomy value created in one note lands in whichever note is active when the response returns.

## Store selectors

Selectors passed to `useItemsAppStore` must return an existing reference or a primitive. One that builds a new object or array each call hands `useSyncExternalStore` a fresh snapshot on every render and hangs the app in an infinite loop. Derive that kind of value with `useMemo` in the component instead.

## User preferences

`notesApp.*` in `user_v1.preferences` (JSONB). Adding a key means editing `TextClientPreferences` in `lib/db-items/contracts/items-app.ts` and regenerating `generated/contracts/items-app.json` with `pnpm --filter @lib/db-items app:contract:generate` — `app:contract:check` gates both `check-types` and `build`. No migration is needed.

Writes go through a 500ms debounced `PATCH /api/session`. Its response must also call `updateItemsCacheUser`, and the background session refresh only keeps the in-memory copy when there is genuinely an unsaved edit — otherwise a changed preference takes two reloads to appear, because the next launch paints from the cached snapshot.

## Anonymous → permanent account (claim or merge, single load path)

Anonymous visitors are real `user_v1` rows (`is_anonymous = true`). Two ways they become permanent, both credentials-based (OAuth login was removed as unfinished):

Anonymous users see a sign-in / create-account toggle in the header popup
(`WorkspaceHeader.tsx`). Mode-switch buttons use `type="button"` so they never
submit the form; the popup closes only after a successful login or signup.

- **Create account (common path, claim-in-place):** `handleSignup` flushes pending saves, POSTs `/api/anon-session/claim` (which sets username/email/hashed password and flips `is_anonymous` on the _same_ row), then re-runs `signIn("credentials")` for the same user id so the JWT's `isAnonymous` flips. No data moves between users, no merge token exists in this path.
- **Sign in to an existing account (merge path):** to keep this race-free there is exactly **one** writer of post-login session data: the `restoreSession` effect in `ItemsApp.tsx`. `handleLogin` only flushes, captures a signed merge token while still anonymous (stashed in `sessionStorage` under `notes-pending-merge-token`), and calls `signIn`. The flush ignores an untouched new editor slot: `savedSignature: null` can make it technically dirty, but it has no content to save and must not block sign-in. Started drafts are still flushed (and a started draft that cannot save still blocks the session change). When `restoreSession` next runs for a real (non-anonymous) session and finds a pending token, it POSTs `/api/anon-session/merge`, then loads the account's data once (skipping the stale cache paint). The login handlers must not load data or run the merge themselves — doing so reintroduces the clobber race.

Merge failure handling (no silent loss): if merge-token capture fails in `handleLogin` while the visitor has notes, the sign-in is aborted with an error so the user retries while still anonymous. If the merge POST itself fails transiently (network/5xx), `restoreSession` re-stashes the token so a page reload retries within the token's 10-minute TTL; a 4xx is permanent (token/anon row invalid) and only shows a warning. Server-side, the merge also carries the visitor's explicitly-set preferences into the real account (per-property, anon wins) — see `lib/db-items`.

`itemSaveStatus` in `itemsAppStore` (`idle | unsaved | saving | saved | error`) drives the header save indicator (`SaveStatusIndicator` in `WorkspaceHeader.tsx`). The save routine owns the status while a request is in flight; otherwise an effect derives it from the draft signature.

- UI uses **Gravity UI** (`@gravity-ui/uikit`) and **Mantine** (`@mantine/core`). No Tailwind. See the Gravity UI agent skills in `.claude/skills/`, and the "UI" section below for when to use which.
- `src/components/ui/FilterablePicker.tsx` is the standard workspace/category/status/tag selector. It owns the value-and-icon trigger (`triggerIcon` replaces the default caret), filtered popup, focused create input, and `multiple` vs single-select behavior (checkboxes and staying open only when `multiple`). Keep the status selector inside `TextCaptureForm`'s More menu; category and tags use the editor toolbar pickers. Do not replace these with native selects or prompt dialogs.
- Routes are wired through `app/api/_lib/items-app-route-handlers.ts` which maps service calls to HTTP responses and translates embedding errors to correct status codes.
- Backup routes use `_lib/backup-route-handlers.ts`. Before transfers, flush notes
  and pending preference writes. Restore is additive: refresh bootstrap/cache
  without resetting open-note drafts. Keep the restore modal outside the account
  Popup so outside-click handling cannot unmount the portaled modal.
- **API auth**: every data route derives the acting user server-side — from the NextAuth session cookie (web) or an `Authorization: Bearer <token>` header (tokens issued by `POST /api/auth/token`). Client-supplied `userId` values are ignored; unauthenticated requests get `401`. Route files pass `resolveSessionUserId` from `_lib/authenticated-user.ts` into the handler factories; tests omit it and authenticate with bearer tokens against the fake service.
- This package consumes item contracts; `@lib/db-items` owns migrations.
  The text client selects `isTextItem` records and requires nonblank text when saving.
  Canonical requests use `/api/items` and `X-Items-Contract: 1`; the legacy Notes
  HTTP facade and persisted identity/storage names are rollout compatibility boundaries.
  See `docs/db/item-core.md`.

## Embedding debug page

`/embeddings` (`app/embeddings/page.tsx`) — calls `POST /api/embeddings/debug`.

- Select **Search task** (default: `retrieval.query`) and **Passage task** (default: `retrieval.passage`) to control the Jina `task` parameter sent for each embedding call.
- These defaults match what the production app uses. Select `(none)` to omit `task` entirely and observe baseline behavior.
- The debug route is standalone — it does not use `itemsAppService` or write to the DB. Search score is cosine similarity between the query embedding and the note description embedding.

## Environment variables

| Variable       | Purpose                                                          |
| -------------- | ---------------------------------------------------------------- |
| `DB_ITEMS_URL` | PostgreSQL connection string (`DB_NOTES_URL` fallback)           |
| `JINA_API_KEY` | Jina AI embeddings key (semantic search + embedding maintenance) |

## Build and dev

```bash
pnpm --filter notes-next dev          # http://localhost:4100
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

### Verify at a layer the UI cannot fake

This app keeps notes in memory and mirrors them to `localStorage`, so the
sidebar, the recent list, and even a page reload will faithfully show a note
that was never stored on the server. Confirming a note "is there" in the
browser proves nothing about persistence.

This is not hypothetical. The open-item ring was manually tested across several
sessions — including recorded demos — while `workspace_item_v1` was empty the whole
time. Every session ran as a fresh anonymous user, and a brand-new account had
no category, so every autosave returned before reaching the network. The local
snapshot reproduced the notes perfectly on reload and nothing looked wrong.

So when testing anything that claims to save:

- **Clear `localStorage` and reload.** Whatever comes back came from the server.
- **Check the database**, not the screen:
  `PGPASSWORD=… psql -h localhost -U postgres -d notes_dev -tAc "SELECT id, left(description,40) FROM public.workspace_item_v1 ORDER BY id DESC LIMIT 10;"`
- **Watch the network tab** for the request and its status. Silence is the
  failure mode to look for — a save that never fires looks identical to one
  that succeeded.
- Prefer an assertion the feature under test cannot satisfy on its own. A save
  path should be checked against Postgres; a cache should be checked with the
  cache cleared.

### When adding automated tests

- Pure logic goes in a module with no React or DOM import so it can be tested
  by the node runner (`src/stores/openItems.ts` is the pattern). There is no
  DOM or React testing setup here and none should be added casually.
- Anything touching persistence belongs in `lib/db-items`' DB-backed suite,
  which runs against `DB_NOTES_TEST_URL` only.
- **Check that a new test fails without its fix.** Two tests in this change
  initially passed either way; one was rewritten after that check, and the
  `cap === 1` ring test exists precisely because every larger cap hides the bug
  it guards.
- Never weaken or delete a failing test to get a green run — no `test.skip`,
  no `.only`, no downgrading an assertion, no fixed timeouts to paper over a
  race. If a test fails, either the code is wrong or the test's intent changed
  and that change needs saying out loud.

## Release rules

- Notes DB migration commands belong in `lib/db-items/package.json`, with root-level wrappers in the repo `package.json`.
- For Notes production changes, the normal order is: repo verify, then Railway deploy; Railway applies pending Notes migrations before activating the release.
- The root `.railway/railway.ts` runs `pnpm --filter @lib/db-items db:migrate` as a pre-deploy command. A migration failure blocks the new release, and `/api/health` returns `DATABASE_SCHEMA_OUTDATED` until the required workspace tables exist. Keep this protection aligned with schema changes rather than allowing code and database deployments to drift.
- Use `db:verify` deliberately; it is not read-only and is mainly for branch validation and controlled contract checks.

## UI

This web app uses 2 libraries. Whenever developing anything, feel free to use components and utilities from either library, whichever is most appropriate.

- Mantine (@mantine/core) mantine.dev/core
- Gravity (@gravity-ui/uikit) gravity-ui.com/components/uikit

Style: prefer clean and minimal styles. Less padding and margin, no unnecessary borders or embelishments. Try to fill the available width and height of the screen.
