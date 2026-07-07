---
name: Fix Anonymous → Permanent Account Sync (Merge Race)
overview: Anonymous visitors save real DB rows, but on sign-in their data no longer appears on the permanent account. Root cause is a client-side race: NextAuth's SessionProvider re-fires the `restoreSession` effect the instant sign-in completes, loading the real account's PRE-merge data and clobbering the merge+reload that `handleLogin` runs in parallel. Login also never flushes pending autosaves, and the OAuth path never reloads after merging. Fix by making a single, merge-aware post-login load path own all data loading, flushing before sign-in, and surfacing merge failures.
todos:
  - id: flush_before_login
    content: Await flushPendingNoteSave() at the start of handleLogin and handleSocialSignIn so in-flight/debounced anon edits are persisted before merge
    status: pending
  - id: unify_merge_token
    content: Store the merge token in sessionStorage for BOTH credentials and OAuth logins (single key), captured while still anonymous
    status: pending
  - id: merge_aware_restore
    content: Make restoreSession the single owner of post-login loading; when a pending merge token exists for a real session, run the merge first, then load once (bypassing the stale cache paint)
    status: pending
  - id: remove_duplicate_reload
    content: Remove the parallel merge+reload block from handleLogin and the standalone OAuth merge effect so there is exactly one loader (no race by construction)
    status: pending
  - id: merge_failure_ux
    content: Surface a recoverable warning when merge fails (expired token, network, deleted anon row) instead of failing silently; keep the real sign-in successful
    status: pending
  - id: embedding_backfill
    content: (Optional, per original plan) run maintainNoteEmbeddingsForNotesApp({ mode "missing" }) for the real user after a successful merge so merged categories/tags are searchable
    status: pending
  - id: tests_verify
    content: Add regression coverage for the merge flow and manually verify the anon→permanent scenarios; run notes-next build/type-check
    status: pending
isProject: false
---

# Fix Anonymous → Permanent Account Sync

## Problem statement

`apps/notes-next` lets any visitor start typing immediately. On first visit the app
calls `signIn("anonymous")`, which creates a **real `user_v1` row** with
`is_anonymous = true` plus real notes/categories/tags. When the visitor signs in to
a permanent account, their anonymous work is supposed to be merged into that
account and the anon row deleted.

This stopped working: the anonymous data appears lost after signing in.

## Confirmed root cause (verified in code)

The database merge itself is intact. The failure is in the **client-side login
orchestration** in `apps/notes-next/src/components/notes/NotesApp.tsx`.

### 1. Race: `restoreSession` vs. `handleLogin` merge+reload (primary bug)

`restoreSession` is an effect keyed on the auth session user id:

```807:894:apps/notes-next/src/components/notes/NotesApp.tsx
    const restoreSession = async () => {
      // ...
      const storedUserId = String(authSession.user.notesUserId)
      // ... cache-first paint, then fetchFreshSession(applyUser: true) → loadNotes/loadCategories/loadTags
    }

    void restoreSession()
    return () => {
      active = false
    }
  }, [
    authSession?.user?.notesUserId,
    authStatus,
    // ...
  ])
```

`handleLogin` gets a merge token, signs in, then merges and reloads:

```1470:1509:apps/notes-next/src/components/notes/NotesApp.tsx
      const result = await signIn("credentials", { identifier, password, redirect: false })
      // ...
      if (mergeToken) {
        const mergeResponse = await fetch("/api/anon-session/merge", { /* ... */ })
        if (mergeResponse.ok) {
          // applyLoadedUser + loadCategories/loadTags/loadNotes + writeNotesCache
        }
      }
```

`SessionProvider` (`app/providers.tsx`) refetches the session after `signIn`, so
`authSession.user.notesUserId` flips to the real user and **`restoreSession`
re-fires**. It loads the real account's *pre-merge* data and writes
`setNotes/setCategories/setTags` + `writeNotesCache`, concurrently with
`handleLogin`'s merge+reload. Two independent writers to the same state race; when
`restoreSession`'s in-flight fetch (started pre-merge) resolves last, it overwrites
the merged view with pre-merge data. The stale-while-revalidate cache
(`src/lib/notesCache.ts`) makes this worse by painting and re-persisting stale data.

Commit `fe7992e` ("fix race condition to merge session and fetch data") added the
post-merge reload to `handleLogin` but did **not** stop `restoreSession` from
running in parallel — so the race remained. Later timing changes (local cache in
`f3fbcd9`, navigation/autosave save in `e814036`) shifted timing enough to make the
loss reliably visible.

### 2. Login does not flush pending autosaves

Sign-out flushes before tearing down the session; login does not:

```1546:1549:apps/notes-next/src/components/notes/NotesApp.tsx
  const handleLogout = async () => {
    await flushPendingNoteSave()
    await signOut({ redirect: false })
```

`handleLogin` (`:1449`) and `handleSocialSignIn` (`:1521`) never call
`flushPendingNoteSave()`. Any edit still inside the 3s autosave debounce is never
written to the anon account, so the merge cannot move it — permanent loss for that
last note.

### 3. OAuth path never reloads after merge

```2175:2191:apps/notes-next/src/components/notes/NotesApp.tsx
  useEffect(() => {
    // ... reads sessionStorage "notes-merge-token"
    void fetch("/api/anon-session/merge", { /* ... */ }).catch(() => {})
  }, [authStatus, authSession?.user?.notesUserId, authSession?.user?.isAnonymous])
```

It fires the merge but never reloads notes/categories/tags, and it races with
`restoreSession` the same way. OAuth users only see merged data after a manual
refresh.

### 4. Silent merge failures

Both login paths swallow merge errors, so an expired token / network blip leaves the
user on the real account with no indication their anon work wasn't transferred.

## Design decision (action requested)

Two viable architectures. **This plan implements Option A** unless directed
otherwise.

### Option A — Single merge-aware client load path (recommended, lower risk)

Make `restoreSession` the *only* place that loads data after login, and teach it to
run the merge first when a pending merge token exists. `handleLogin` /
`handleSocialSignIn` are reduced to: flush → capture token → stash token → signIn.
They no longer do their own merge+reload. Because there is then exactly one loader,
the race is eliminated by construction, and the credentials and OAuth paths become
identical.

- Pros: minimal surface area, no NextAuth internals touched, unifies OAuth +
  credentials, removes duplicated reload logic, deterministic.
- Cons: still a brief pre-merge paint is possible for cached returning users unless
  we suppress the cache path when a merge is pending (handled below).

### Option B — Merge inside the NextAuth flow (more robust, more invasive)

Thread the merge token into the credentials `authorize` (extra credential) and into
OAuth via a short-lived cookie set before redirect, then run the merge inside the
`jwt`/`signIn` callback so the session returned to the client already reflects the
merged account.

- Pros: no client race window at all; client just loads "the current user".
- Cons: DB work (pg) must run in the Node runtime auth context; OAuth requires a
  pre-redirect cookie dance; more moving parts and higher regression risk in the
  auth layer.

**Recommendation:** Option A now (fixes the reported bug with low risk). Consider
Option B later only if we want to harden further. **Please confirm A, or ask for B.**

## Implementation plan (Option A)

All changes are in `apps/notes-next/src/components/notes/NotesApp.tsx` unless noted.

### Step 1 — Flush before sign-in

At the top of both `handleLogin` and `handleSocialSignIn`, before requesting the
merge token, `await flushPendingNoteSave()` so the outgoing anon draft is persisted
to the anon account and becomes eligible for merge. Update
`apps/notes-next/AGENTS.md` to list login among the flush triggers.

### Step 2 — Unify merge-token capture

Use one `sessionStorage` key (e.g. `notes-pending-merge-token`) for both paths.
While still anonymous:

- `handleLogin`: flush → `POST /api/anon-session/merge-token` → store token in
  sessionStorage → `signIn("credentials", { redirect: false })`. Remove the inline
  merge+reload block.
- `handleSocialSignIn`: flush → get token → store in sessionStorage →
  `signIn(provider, { callbackUrl: "/" })` (unchanged redirect behavior).

### Step 3 — Merge-aware `restoreSession`

Inside `restoreSession`, after confirming an authenticated **non-anonymous** session:

1. Read the pending merge token from sessionStorage.
2. If present:
   - **Skip the stale cache-first paint** (do not early-return on `cachedSnapshot`)
     so we never show pre-merge data for this login.
   - `await fetch("/api/anon-session/merge", { body: { mergeToken } })`.
   - On success: remove the token; continue to the normal
     `fetchFreshSession(storedUserId, { applyUser: true })` load, which now returns
     post-merge data and writes the fresh cache. (Optionally seed state from the
     merge response's user to avoid a flash.)
   - On failure: remove the token (or keep for one retry), set a recoverable warning
     via `setErrorMessage`/status, and still load the real account so the user is not
     stuck. Do **not** sign the user out.
3. If absent: existing behavior (cache-first paint + background refresh) is unchanged.

Guard against double-merge with a ref (e.g. `mergeAttemptedRef`) so a re-render
during the async merge doesn't fire it twice; the sessionStorage removal is the
primary idempotency guard, the ref is belt-and-suspenders.

### Step 4 — Remove the duplicate loaders

- Delete the merge+reload block inside `handleLogin` (now handled by
  `restoreSession`).
- Delete the standalone OAuth merge effect at `:2175` (now handled by the same
  merge-aware `restoreSession`). This removes both racing writers.

### Step 5 — Merge failure UX

When the merge call fails, show a non-blocking, recoverable warning (Gravity UI
toast or the existing status/error banner) such as: "Signed in, but we couldn't move
your unsaved visitor notes. They're safe — try signing in again." Keep the real
sign-in successful; the abandoned anon row remains eligible for the cleanup script.

### Step 6 — (Optional) Embedding backfill after merge

The original plan (`.cursor/plans/anonymous_sessions_26b7a04c.plan.md`, "Embedding
backfill after merge") specified running embedding maintenance after merge so newly
inserted categories/tags are searchable. It was never implemented.
`mergeAnonymousNotesAppSession` in `lib/db-marketing/services/notes-app.ts` only runs
the SQL. If we want this, call `maintainNoteEmbeddingsForNotesApp({ mode: "missing" })`
for the real user after the merge transaction commits (guarded so a missing
`JINA_API_KEY` doesn't fail the merge). Low priority; not required to fix the bug.

## Server-side merge (`lib/db-marketing/sql/user/anonymous.ts`)

`mergeAnonymousUserInto` was reviewed and is sound: dedupe categories/tags by
`(user_id, label)`, reassign notes with category remap, remap tag links, delete the
anon user under `FOR UPDATE` on the real user. **No changes required** for the fix.
Minor cleanups (harmless, optional): drop the unused `[realUserId, anonUserId]`
params in the tag-link `UPDATE` (`:143`).

## Files touched

| File | Change |
|------|--------|
| `apps/notes-next/src/components/notes/NotesApp.tsx` | Flush before login; unify token capture; merge-aware `restoreSession`; remove duplicate loaders; failure UX |
| `apps/notes-next/AGENTS.md` | Add login to the documented flush triggers; note the merge-aware restore path |
| `lib/db-marketing/services/notes-app.ts` | (Optional) embedding backfill after merge |
| `lib/db-marketing/sql/user/anonymous.ts` | (Optional) remove dead query params |

## Verification

Manual test matrix (Cursor Cloud: start Postgres + pg17 PATH per root `AGENTS.md`):

1. **Credentials, existing account** — as anon create a note + category, wait for
   autosave, sign in → merged notes appear immediately; anon `user_v1` row deleted.
2. **Fast login** — type a note and sign in within 3s → note is flushed then merged
   (validates Step 1).
3. **OAuth** — same flow via a configured provider → merged data appears without a
   manual refresh (validates Steps 2–4).
4. **Returning account with prior notes** — anon work + existing notes both visible,
   categories/tags deduped by label.
5. **Merge failure** — simulate an expired/invalid token → user is signed in, sees a
   recoverable warning, real account still loads.
6. **DB check** — confirm anon row removed and notes reassigned to the real user id.

Automated: `pnpm --filter notes-next check-types`, `pnpm --filter notes-next build`,
`pnpm --filter notes-next test`. Add a regression test around the merge flow if the
harness allows mocking the session (there is currently no coverage of anon merge).

## Open questions for the requester

1. **Architecture:** proceed with Option A (client, recommended), or do you want the
   more robust server-side Option B (merge inside the NextAuth flow)?
2. **Anonymous preferences** (e.g. results column width) currently die with the anon
   row. Should we carry them over to the real account (only when the real account is
   still on defaults), or intentionally drop them?
3. **Embedding backfill after merge** (Step 6) — implement now, or defer?
