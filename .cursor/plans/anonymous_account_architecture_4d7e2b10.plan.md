---
name: Anonymous Account Architecture — Claim-in-Place Signup (Phase 2)
overview: Turn an anonymous visitor into a permanent account without moving data between users. Phase 1 (shipped) made restoreSession the single post-login loader and merge trigger, fixing the sign-in race. Phase 2 removes the unfinished OAuth login, introduces password hashing, and adds a signup flow that upgrades the anonymous user row in place (same user_id, zero data movement). The only remaining cross-user merge — logging into a pre-existing account — stays server-side behind the existing token flow and gains an automated schema-coverage guard so new user-owned tables cannot be silently forgotten.
todos:
  - id: p1_shipped
    content: Phase 1 (SHIPPED, PR
    status: completed
  - id: p2_remove_oauth
    content: Remove the unfinished OAuth login — social buttons in NotesHeader, handleSocialSignIn in NotesApp, social providers + OAuth branches in auth.ts, and the dead LoginForm.tsx; update AGENTS.md references
    status: completed
  - id: p2_password_hashing
    content: Introduce scrypt password hashing (node:crypto, no new dependency) — hash helper in lib/db-marketing, verifyUserCredentials accepts hashed with legacy-plaintext fallback and rehashes on successful login
    status: completed
  - id: p2_claim_sql
    content: Add claimAnonymousUser DB helper — upgrade the anonymous row in place (username, optional email, hashed password, is_anonymous=false) in one transaction with identity-uniqueness checks
    status: completed
  - id: p2_claim_service_api
    content: Add claimAnonymousNotesAppSession service function and POST /api/anon-session/claim (caller must be the anonymous session; 409 on identifier conflict)
    status: completed
  - id: p2_signup_ui
    content: Add Create-account toggle to the NotesHeader popup; signup handler = flush → claim → signIn(credentials) for the same user id; no merge token in this path
    status: completed
  - id: p2_merge_guard
    content: Add a merge schema-coverage guard — MERGE_TABLE_STRATEGIES beside mergeAnonymousUserInto, diffed against information_schema FKs to user_v1 by db:verify (implemented in verify-contract.mjs since lib/db-marketing has no test runner)
    status: completed
  - id: p2_verify
    content: Verified against a live local Postgres — claim keeps user id with zero data movement, conflicts 409, legacy plaintext logins rehash to scrypt, existing-account merge unchanged, coverage guard fails on an unregistered probe table; check-types/build/test all pass
    status: completed
isProject: false
---

# Anonymous Account Architecture — Phase 2

## Context: what Phase 1 shipped (do not redo)

Anonymous visitors are backed by a real `user_v1` row (`is_anonymous = true`) with
real notes/categories/tags. Phase 1 (merged in PR #61, commits `30ea144`/`25e172a`)
fixed the sign-in race that lost visitor notes and established the invariant Phase 2
builds on:

> **There is exactly one writer of post-login session data:** the `restoreSession`
> effect in `NotesApp.tsx`. Login handlers only flush pending saves, capture a signed
> merge token while still anonymous (`sessionStorage` key
> `notes-pending-merge-token`), and call `signIn`. `restoreSession` performs the
> merge (when a token is pending) and then loads the account's data once, skipping
> the stale cache paint. **Nothing else may load session data or trigger the merge.**

This is also documented in `apps/notes-next/AGENTS.md` ("Anonymous → permanent
account merge"). Any Phase 2 change must preserve it. For the full Phase 1 design
history (race analysis, three-writer diagram), see this plan's git history and the
PR #61 description.

## Decisions locked in (product owner, Jul 2026)

1. **Password hashing now.** Passwords are currently stored and compared in
   plaintext (`verifyUserCredentials` does `row.password !== password`). Signup is
   the first flow that writes a password, so hashing lands with it. Legacy plaintext
   rows keep working via fallback and are upgraded on successful login.
2. **Remove OAuth login.** The social login is unfinished and not working; remove it
   from UI and auth config rather than carrying it through this rework. OAuth (login
   or signup) can return later as its own project.
3. **Signup fields:** username + password required, email optional. Phone is not
   part of the signup form.

## Insight

Turning a visitor into an account has two distinct cases:

- **New account (the common path):** there is no second user. Nothing moves — we
  upgrade the anonymous row in place. `user_id` stays stable, so there is no
  cross-user load and no race is even possible. Bonus: the visitor's UI preferences
  (stored on the same row) survive automatically, which resolves the open
  preferences question in `anonymous_merge_sync_fix_8f2c1a90.plan.md` §5 for this
  path. No embedding backfill is needed either — no rows change owner.
- **Log into a pre-existing account (the rare path):** two rows genuinely exist and
  must be reconciled. This keeps the Phase 1 merge flow, plus a schema-coverage
  guard (Part C).

### Key files

| Layer                         | File                                                                          |
| ----------------------------- | ----------------------------------------------------------------------------- |
| UI / load orchestration       | `apps/notes-next/src/components/notes/NotesApp.tsx`                           |
| Login/signup popup            | `apps/notes-next/src/components/notes/NotesHeader.tsx`                        |
| Auth (providers, JWT/session) | `apps/notes-next/src/auth.ts`                                                 |
| Credential lookup / user SQL  | `lib/db-marketing/sql/user/gets.ts`, `lib/db-marketing/sql/user/anonymous.ts` |
| Service layer                 | `lib/db-marketing/services/notes-app.ts`                                      |
| Anon-session routes           | `apps/notes-next/app/api/anon-session/*`                                      |
| Docs to update                | `apps/notes-next/AGENTS.md`                                                   |

No DB migration is required anywhere in this phase: `user_v1.password` is already
`text`, `is_anonymous` exists, and no tables are added.

## Part 0 — Remove the unfinished OAuth login

Do this first; it shrinks every later step.

- `NotesHeader.tsx`: remove the `SOCIAL_PROVIDERS` list and the "Continue with …"
  buttons; drop the `onSocialSignIn` prop.
- `NotesApp.tsx`: remove `handleSocialSignIn` and its wiring.
- `src/auth.ts`: remove the `socialProviders` array and provider imports, the OAuth
  branch of the `signIn` callback (`resolveNotesUserId` becomes unused — remove it),
  and the OAuth branch of the `jwt` callback. Keep the `credentials` and `anonymous`
  providers only.
- Delete `src/components/notes/LoginForm.tsx` + `LoginForm.module.css` — dead code
  (nothing imports it; the only live login UI is the header popup).
- `apps/notes-next/AGENTS.md`: remove `handleSocialSignIn` from the flush-trigger
  list and the merge section; remove `LoginForm.tsx` from the directory listing.

Note: OAuth removal does not orphan any accounts — OAuth sign-in only ever mapped to
existing rows by email; those users can use credentials once they have a password
(out of scope here).

## Part A — Password hashing

### A1. Hash helper

New module `lib/db-marketing/sql/user/password.ts` using `node:crypto` scrypt (no
new dependency):

- `hashPassword(plain): string` → self-describing format, e.g.
  `scrypt$<N>$<r>$<p>$<saltB64>$<hashB64>`.
- `verifyPassword(plain, stored): boolean` → if `stored` starts with `scrypt$`,
  scrypt-compare (timing-safe); otherwise legacy plaintext compare (`stored === plain`).
- Export both from `sql/user/index.ts`.

### A2. Wire into verification

`verifyUserCredentials` (`sql/user/gets.ts`) switches from `row.password !== password`
to `verifyPassword(password, row.password)`. On a successful **legacy** match,
rehash: `UPDATE user_v1 SET password = <hash> WHERE id = <id>` (best-effort; login
must succeed even if the rehash write fails).

This one function covers both clients: the web credentials provider (`auth.ts`) and
the Android token login (`loginNotesAppUser` → `POST /api/auth/token`) both call it.
No other call sites exist.

## Part B — Claim the anonymous user in place (signup)

### B1. DB helper

`claimAnonymousUser` in `lib/db-marketing/sql/user/anonymous.ts`, one transaction:

```
claimAnonymousUser(anonUserId, { username, password, email? }): Promise<UserSummary>
  1. SELECT is_anonymous FROM user_v1 WHERE id = $anonUserId FOR UPDATE
     → throw ("not anonymous" / "not found") otherwise.
  2. App-level identity check: no OTHER user may already match the chosen
     username/email under the same normalization findUserByIdentifier uses
     (lower(username), lower(email); is_anonymous = false). Throw a distinct
     "identifier taken" error (service maps it to 409).
  3. UPDATE user_v1 SET username = $username, email = $email,
     password = hashPassword($password), is_anonymous = false
     WHERE id = $anonUserId
     RETURNING id, username, email, phone, preferences.
  4. Catch unique_violation (23505) on user_v1_username_key and rethrow as the
     same "identifier taken" error.
```

Schema reality behind step 2/4: `username` has a **global** UNIQUE constraint
(spanning anonymous rows too — collisions with `anon-<uuid>` names are theoretical
but the 23505 handler covers them); `email` and `phone` have **no** DB uniqueness,
so the app-level check is the only guard for email. Checking against
non-anonymous rows only is correct — this row is still anonymous at that moment, so
it excludes itself automatically.

Input validation (service layer): trimmed non-empty username, password ≥ 8 chars,
optional email must contain `@` if present.

### B2. Service + API

- `claimAnonymousNotesAppSession({ anonUserId, username, password, email? })` in
  `lib/db-marketing/services/notes-app.ts`, returning `SessionResponse` like the
  merge service. Add a `parseClaimRequest` following the existing parse helpers.
  Map "identifier taken" to a 409 in `getNotesAppErrorStatus` (or route-level).
- `POST /api/anon-session/claim` (`apps/notes-next/app/api/anon-session/claim/route.ts`):
  `auth()` session must exist with `session.user.isAnonymous === true`; call the
  service with `anonUserId = session.user.notesUserId`. Import the service function
  directly, matching the existing `merge/route.ts` pattern. Responses: 200 with
  `{ user }`, 400 validation, 401 not anonymous, 409 identifier taken.

### B3. Client flow (race-free by construction)

Extend the anonymous branch of the `NotesHeader` popup with a Sign in / Create
account toggle (two small forms; signup fields: username, email (optional),
password). Follow the existing prop pattern (`onSignupSubmit` etc. from `NotesApp`)
— the handler must live in `NotesApp` because it calls `signIn` and
`setSessionLoading`.

`handleSignup` in `NotesApp.tsx`:

1. `await flushPendingNoteSave()` — same reason as `handleLogin`: the outgoing
   draft must reach the DB (it stays on the same row, but the debounced save must
   not fire after the form state resets).
2. `POST /api/anon-session/claim`. On 409 show "That username or email is already
   taken — sign in instead?"; on other failure show the error. **No merge token is
   captured in this path** — there is nothing to merge.
3. On success, `signIn("credentials", { identifier: username, password,
redirect: false })`. This re-mints the JWT for the **same** `user_id` with
   `isAnonymous = false` (the `jwt` callback sets `isAnonymous` from the `user`
   object at initial sign-in, so re-signing-in is the clean way to flip it —
   simpler than teaching the callback about `trigger === "update"`).
4. `setSessionLoading(true)`; `restoreSession` re-fires (its deps include
   `isAnonymous`), finds no pending merge token, and just refreshes the same
   account — cache-first is fine here since the cached snapshot is the same user's
   data.
5. Edge case: if the claim succeeded but the `signIn` call fails, the account is
   already claimed and the JWT still says anonymous. Show "Account created — sign
   in with your new username and password" (the popup login form now works for it).
   Do not attempt to roll back the claim.

### B4. Existing guards that make this safe (verify, don't build)

- `verifyUserCredentials`/`findUserByIdentifier` filter `is_anonymous = false`, so
  an anonymous placeholder username can never satisfy a login; after claim the row
  is a normal account.
- `/api/anon-session/merge-token` requires an anonymous session; a claimed session
  can no longer mint merge tokens.

## Part C — Existing-account login: keep the merge, add a schema-coverage guard

Logging into a pre-existing account from an anonymous session keeps the Phase 1
flow unchanged: token stash in `handleLogin` → `signIn` → `restoreSession` POSTs
`/api/anon-session/merge` → `mergeAnonymousUserInto` reconciles server-side
(dedup categories/tags by label, reparent notes, remap tag links, delete anon row).

The durability problem: the merge hard-codes each table, so every new user-owned
table is a place to forget. There is already one: `user_api_token_v1` references
`user_v1` and is not handled (anon tokens die with the CASCADE delete — acceptable,
but currently undocumented). Instead of a dynamic reassignment registry (more
machinery than a five-table schema needs), make forgetting impossible:

- In `sql/user/anonymous.ts`, next to `mergeAnonymousUserInto`, export a
  hand-maintained map `MERGE_TABLE_STRATEGIES: Record<tableName, "dedup-remap" |
"reparent" | "drop">` documenting every table with a direct FK to `user_v1` and
  what the merge does with it. Today: `user_note_category_v1: "dedup-remap"`,
  `user_note_tag_v1: "dedup-remap"`, `user_note_v1: "reparent"`,
  `user_api_token_v1: "drop"` (anon tokens are intentionally discarded by
  CASCADE). (`user_note_tag_link_v1` has no direct FK to `user_v1`; it is owned
  via tag and remapped as part of the tag dedup.)
- The guard lives in `scripts/verify-contract.mjs` (run by `db:verify`), since
  `lib/db-marketing` has no test runner: it reads the map's keys out of
  `anonymous.ts` and diffs them against `pg_constraint` FKs referencing
  `public.user_v1`, failing when a referencing table is unregistered. Adding a
  new user-owned table then forces a conscious decision in code review instead
  of a silent data hole.

The merge SQL itself stays explicit — it already serializes concurrent merges via
`FOR UPDATE` on the real user and is idempotent per Phase 1.

## Documentation updates

- `apps/notes-next/AGENTS.md`: update the merge section and flush-trigger list
  (signup added, OAuth removed), directory listing (LoginForm deleted, claim route
  added), and mention the claim endpoint under API routes.
- `lib/db-marketing/AGENTS.md`: note the password format (`scrypt$…` with legacy
  plaintext fallback) and the `MERGE_TABLE_STRATEGIES` guard.

## Verification (all performed against a throwaway local Postgres 17 + pgvector)

1. **Signup (claim-in-place)** — full HTTP flow against the built app (`next
start`): anonymous sign-in → create category + note → `POST
/api/anon-session/claim` → credentials re-sign-in. Same `user_v1.id` end to
   end, `is_anonymous` flipped, `password` stored as `scrypt$…`, the pre-claim
   note visible after claim, zero rows changed `user_id`. ✔
2. **Signup conflicts** — short password → 400; duplicate username from a second
   anonymous session → 409; failed claim rolls back (row stays anonymous); a
   claimed session can no longer call claim (401) or mint merge tokens (400). ✔
3. **Existing-account login** — SQL-level merge into the claimed account still
   reparents notes, dedupes colliding category labels, and deletes the anon row. ✔
4. **Hashing** — claimed credentials log in by username and by email
   (case-insensitive); a manually seeded plaintext-password row still logs in and
   is rehashed to `scrypt$…`; rehashed credentials log in again. ✔
5. **Coverage guard** — `db:verify` passes on the real schema; creating a
   throwaway `tmp_probe_v1` table with a `user_id` FK makes it fail with the
   registration error until the table is dropped. ✔
6. `tsc --noEmit` (db-marketing), `check-types`, `build`, `test` (35/35) pass. ✔
7. No schema changes were needed (`password`/`is_anonymous` already existed), so
   no migration; `verify-contract.mjs` gained the coverage guard only.

### Note found and fixed during verification

`verifyUserCredentials`/`findUserByIdentifier` matched the phone clause against an
empty digit string when the identifier had no digits (e.g. username `claim_user` →
`phoneDigits = ""`), which matched any user whose phone is NULL/empty — the
`ORDER BY id ASC LIMIT 1` then returned the wrong row. The phone clause now
requires a non-empty digit string (`$2 <> ''`). This was pre-existing but became
visible once hashed and plaintext rows coexisted.
