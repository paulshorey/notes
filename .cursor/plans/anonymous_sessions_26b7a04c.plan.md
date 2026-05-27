---
name: Anonymous Sessions
overview: Let new visitors use the app without signing in by lazily provisioning a real `user_v1` row marked `is_anonymous`, then merge their data into a real account on sign-in (deduping categories and tags by label). Reuses the existing API and NextAuth machinery; offline editing remains a separate future feature.
todos:
  - id: schema
    content: Add migration adding is_anonymous and partial index, regenerate schema/types/contracts, update verify-contract.mjs
    status: pending
  - id: sql_helpers
    content: Add createAnonymousUser, filter anons from findUserByIdentifier, implement transactional mergeAnonymousUserInto
    status: pending
  - id: service
    content: Add createAnonymousNotesAppSession and mergeAnonymousNotesAppSession to notes-app service
    status: pending
  - id: auth
    content: Add anonymous Credentials provider in src/auth.ts; surface isAnonymous through JWT/session types and callbacks
    status: pending
  - id: api_route
    content: Add POST /api/anon-session/merge route that authorizes via auth() and calls the merge service
    status: pending
  - id: frontend
    content: Add 'Continue without signing in' button to LoginForm; capture anon userId before credentials signIn and call merge endpoint after success; add anon banner
    status: pending
  - id: cleanup
    content: Add cleanup-anonymous-users.mjs script and root-level db:anon:cleanup proxy
    status: pending
  - id: verify
    content: Run db:migrate, db:verify, notes-next build; manual end-to-end test of anon flow + merge
    status: pending
isProject: false
---

# Anonymous Sessions

Anonymous users get a real `user_v1` row marked `is_anonymous`. They use the existing API exactly like a signed-in user. On sign-in, we move their notes/categories/tags to the real account (deduping categories and tags by `(user_id, label)`) and delete the anon user.

## Schema

Single migration, single new column on [lib/db-marketing/schema/current.sql](lib/db-marketing/schema/current.sql) via a new file `lib/db-marketing/migrations/<ts>__user_anonymous.sql`:

```sql
ALTER TABLE public.user_v1
  ADD COLUMN is_anonymous boolean NOT NULL DEFAULT false;

CREATE INDEX user_v1_is_anonymous_idx
  ON public.user_v1 (is_anonymous)
  WHERE is_anonymous = true;
```

Anonymity for any row in any child table is `JOIN user_v1 ON user_id = user_v1.id`. The partial index makes cleanup queries cheap without taxing signed-in writes.

`username` stays `NOT NULL UNIQUE`; we satisfy it for anons by inserting `username = 'anon-' || gen_random_uuid()`. (`gen_random_uuid()` is in `pgcrypto`, already provided by Postgres 17 core.)

After running the migration, regenerate:

- [lib/db-marketing/schema/current.sql](lib/db-marketing/schema/current.sql)
- [lib/db-marketing/generated/typescript/db-types.ts](lib/db-marketing/generated/typescript/db-types.ts)
- [lib/db-marketing/generated/contracts/db-schema.json](lib/db-marketing/generated/contracts/db-schema.json)

Update [lib/db-marketing/scripts/verify-contract.mjs](lib/db-marketing/scripts/verify-contract.mjs) to assert:

- `user_v1.is_anonymous` exists, type `boolean`, NOT NULL, default `false`.
- Index `user_v1_is_anonymous_idx` exists and is partial (`WHERE is_anonymous = true`).

## SQL helpers

In [lib/db-marketing/sql/user/gets.ts](lib/db-marketing/sql/user/gets.ts) (or a new sibling `lib/db-marketing/sql/user/anonymous.ts`):

- `createAnonymousUser()` — `INSERT INTO user_v1 (username, is_anonymous) VALUES ('anon-' || gen_random_uuid(), true) RETURNING ...`. Returns `UserSummary`.
- Filter anons out of credential lookup: in `findUserByIdentifier`, add `AND is_anonymous = false` so anon usernames can never satisfy a sign-in. `verifyUserCredentials` is already safe (anons have `password = NULL`).

In a new `lib/db-marketing/sql/user/merge.ts`, add `mergeAnonymousUserInto(anonUserId, realUserId)` running in a single transaction:

1. Verify `anonUserId.is_anonymous = true` and `realUserId.is_anonymous = false`. Throw otherwise.
2. **Lock the destination user** to serialize concurrent merges into the same real account (e.g. user signs in on two devices nearly simultaneously):
   ```sql
   SELECT id FROM user_v1 WHERE id = $real FOR UPDATE;
   ```
3. **Categories**: insert anon labels into the real user, dedupe by unique `(user_id, label)`:
   ```sql
   INSERT INTO user_note_category_v1 (user_id, label)
   SELECT $real, label FROM user_note_category_v1 WHERE user_id = $anon
   ON CONFLICT (user_id, label) DO NOTHING;
   ```
   Build the remap by joining anon → real by `label`:
   ```sql
   SELECT a.id AS anon_id, r.id AS real_id
   FROM user_note_category_v1 a
   JOIN user_note_category_v1 r
     ON r.user_id = $real AND r.label = a.label
   WHERE a.user_id = $anon;
   ```
4. **Tags**: same pattern against `user_note_tag_v1`.
5. **Notes**: reassign and remap category in one statement:
   ```sql
   UPDATE user_note_v1 n
   SET user_id = $real,
       category_id = m.real_id
   FROM (<category remap>) m
   WHERE n.user_id = $anon AND n.category_id = m.anon_id;
   ```
6. **Tag links**: remap tag IDs on the (now-real-owned) notes:
   ```sql
   UPDATE user_note_tag_link_v1 l
   SET tag_id = m.real_id
   FROM (<tag remap>) m
   WHERE l.tag_id = m.anon_id;
   ```
   No PK collisions are possible here because each anon note linked only to anon tags, and the remap is 1:1 by label within the anon user.
7. `DELETE FROM user_v1 WHERE id = $anon`. CASCADE cleans up the now-empty anon-owned `user_note_category_v1` and `user_note_tag_v1` rows.

This logic is **safe across multiple sequential merges into the same real account** (e.g. a user signs in on phone, then later on laptop). Each merge only touches rows tagged with its source `anonUserId`, and `ON CONFLICT (user_id, label) DO NOTHING` correctly dedupes against whatever is already there from a previous merge.

### Embedding backfill after merge

The merge SQL bypasses the usual service-layer paths that generate Jina embeddings on category/tag creation, so any *new* categories or tags inserted into the real user during merge will have `category_embedding` / `tag_embedding = NULL`. After the transaction commits, call the existing embedding maintenance flow (`mode=missing`) for the real user to backfill them. This makes newly-merged categories and tags discoverable by semantic search.

(Notes themselves don't need a backfill — their `description_embedding` was generated when the anon user originally created the note and the description doesn't change during merge.)

Add service wrappers in [lib/db-marketing/services/notes-app.ts](lib/db-marketing/services/notes-app.ts):

- `createAnonymousNotesAppSession(): Promise<SessionResponse>`
- `mergeAnonymousNotesAppSession({ anonUserId, realUserId }): Promise<SessionResponse>` — runs the SQL transaction, then triggers `mode=missing` embedding maintenance for the real user before returning.

## NextAuth: anonymous as a Credentials provider

Reuse the existing JWT session machinery instead of building a parallel anon-auth path. In [apps/notes-next/src/auth.ts](apps/notes-next/src/auth.ts) add a second Credentials provider:

```ts
Credentials({
  id: "anonymous",
  name: "Anonymous",
  credentials: {},
  authorize: async () => {
    const user = await createAnonymousUser()
    return {
      id: String(user.id),
      name: user.username,
      notesUserId: user.id,
      isAnonymous: true,
    }
  },
}),
```

Extend the JWT and session callbacks to carry `isAnonymous`:

- Add `isAnonymous?: boolean` to the `JWT` and `Session.user` type augmentations in [apps/notes-next/src/types/next-auth.d.ts](apps/notes-next/src/types/next-auth.d.ts).
- In the `jwt` callback, set `token.isAnonymous` from `user.isAnonymous` (credentials path) or default to `false` for OAuth/credentials sign-ins.
- In the `session` callback, surface it on `session.user.isAnonymous`.

API routes don't need changes — `auth()` already returns the right `notesUserId` for both anon and real users.

## API route

`POST /api/anon-session/merge` at [apps/notes-next/app/api/anon-session/merge/route.ts](apps/notes-next/app/api/anon-session/merge/route.ts):

1. `const session = await auth()`. If `!session?.user?.notesUserId` or `session.user.isAnonymous`, return 401/400.
2. Parse body `{ anonUserId: number }`.
3. Call `mergeAnonymousNotesAppSession({ anonUserId, realUserId: session.user.notesUserId })`.
4. Return the updated user payload.

No new endpoint is needed for _creating_ the anon session — `signIn("anonymous")` does that.

## Frontend

[apps/notes-next/src/components/notes/LoginForm.tsx](apps/notes-next/src/components/notes/LoginForm.tsx):

- Add a "Continue without signing in" button below the social provider buttons. Calls `signIn("anonymous", { redirect: false })`.

[apps/notes-next/src/components/notes/NotesApp.tsx](apps/notes-next/src/components/notes/NotesApp.tsx):

- The existing `useSession` flow already handles `notesUserId` for any authenticated session, so once an anon signs in via `signIn("anonymous")` the rest of the app loads notes/categories/tags identically.
- Wrap `handleLogin` (credentials sign-in): before calling `signIn("credentials", ...)`, capture `authSession?.user?.notesUserId` and `authSession?.user?.isAnonymous` into a ref. After a successful real sign-in, if `wasAnonymous`, call `POST /api/anon-session/merge` with the captured anon id, then re-fetch notes/categories/tags (or just trust the next session refresh and `notesCache` invalidation).
- Same wrapping for `handleSocialSignIn` once social providers are configured.
- Add a small banner (Mantine `Alert` or Gravity `Card`) shown when `session.user.isAnonymous === true`: "You're using the app anonymously. Sign in to keep your notes." with a link/button that opens the login form.
- [apps/notes-next/src/lib/notesCache.ts](apps/notes-next/src/lib/notesCache.ts) needs no changes — it's keyed by `userId`, so the cache simply re-keys after merge.

## Maintenance

We deliberately do **not** add a `last_active_at` column to `user_v1`. Reasons:

- `user_v1.time_modified` only bumps when the user row itself changes (preferences), not when notes/categories/tags do, so it's not usable for cleanup as-is.
- A new column with child-table triggers would impose write-path overhead on every signed-in mutation, just to speed up a maintenance query that runs weekly at most.
- An application-layer column bump (extra UPDATE per mutation) is brittle and easy to forget on new endpoints.
- The partial index `user_v1_is_anonymous_idx` already narrows the cleanup scan to a tiny subset, and each `NOT EXISTS` lookup hits indexed FK columns — fast at any realistic scale.

If the app ever grows past the point where this matters, we can add the column then with a backfill migration.

New script `lib/db-marketing/scripts/cleanup-anonymous-users.mjs`:

```sql
DELETE FROM public.user_v1 u
WHERE u.is_anonymous = true
  AND u.time_created < now() - interval '30 days'
  AND NOT EXISTS (SELECT 1 FROM public.user_note_v1 n
                  WHERE n.user_id = u.id AND n.time_modified > now() - interval '30 days')
  AND NOT EXISTS (SELECT 1 FROM public.user_note_category_v1 c
                  WHERE c.user_id = u.id AND c.time_modified > now() - interval '30 days')
  AND NOT EXISTS (SELECT 1 FROM public.user_note_tag_v1 t
                  WHERE t.user_id = u.id AND t.time_modified > now() - interval '30 days');
```

CASCADE deletes the child rows. Add a root-level proxy `db:anon:cleanup` in [package.json](package.json). Run manually for now; promote to scheduled job later if needed.

## Verify and ship

- `pnpm run db:migrate` — apply migration locally.
- `pnpm run db:verify` — confirm verify-contract assertions pass.
- `pnpm --filter notes-next build` — typecheck and build.
- Manual test: open app fresh → click "Continue without signing in" → create notes/categories/tags → sign in with existing credentials → verify the anonymous data appears under the signed-in account, with category/tag dedupe working correctly.

## Out of scope (explicitly deferred)

- Offline editing / write queue (Approach C) — separate future branch.
- Android anonymous mode — web-only this time.
- Sign-up flow for new accounts.
- UX polish on the anon banner / sign-in prompt timing.

## Data flow

```mermaid
sequenceDiagram
    participant Browser
    participant NextAuth
    participant NotesAPI as Notes API
    participant DB as Postgres

    Note over Browser: First visit, no session
    Browser->>NextAuth: signIn("anonymous")
    NextAuth->>DB: INSERT user_v1 (is_anonymous=true)
    DB-->>NextAuth: anon user row
    NextAuth-->>Browser: JWT cookie (notesUserId=42, isAnonymous=true)

    Browser->>NotesAPI: POST /api/notes (userId=42)
    NotesAPI->>DB: INSERT user_note_v1 (user_id=42)

    Note over Browser: User decides to sign in
    Browser->>Browser: capture anonUserId=42 from session
    Browser->>NextAuth: signIn("credentials", {identifier, password})
    NextAuth->>DB: verifyUserCredentials
    DB-->>NextAuth: real user row (id=7)
    NextAuth-->>Browser: JWT cookie (notesUserId=7, isAnonymous=false)

    Browser->>NotesAPI: POST /api/anon-session/merge {anonUserId: 42}
    NotesAPI->>DB: BEGIN
    NotesAPI->>DB: dedupe categories, build remap
    NotesAPI->>DB: dedupe tags, build remap
    NotesAPI->>DB: UPDATE notes SET user_id=7, category_id=remap
    NotesAPI->>DB: UPDATE tag_links SET tag_id=remap
    NotesAPI->>DB: DELETE user_v1 WHERE id=42 (CASCADE)
    NotesAPI->>DB: COMMIT
    NotesAPI-->>Browser: merged user payload
```
