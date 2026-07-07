---
name: Anonymous Merge — Correctness & Robustness Improvements
overview: Supporting improvements around anonymous→permanent account merge that are independent of the load-path architecture rework. Covers persisting the outgoing draft before sign-in, surfacing merge failures instead of failing silently, backfilling embeddings for merged categories/tags, a small SQL cleanup, and a test/verification pass. The core race fix and the longer-term account model live in the separate architecture plan (`anonymous_account_architecture_4d7e2b10.plan.md`).
todos:
  - id: flush_before_login
    content: Await flushPendingNoteSave() at the start of handleLogin and handleSocialSignIn so in-flight/debounced anon edits are persisted before the session changes
    status: pending
  - id: merge_failure_ux
    content: Surface a recoverable warning when merge fails (expired token, network, deleted anon row) instead of failing silently; keep the real sign-in successful
    status: pending
  - id: embedding_backfill
    content: Run maintainNoteEmbeddingsForNotesApp({ mode "missing" }) for the real user after a successful merge so merged categories/tags are searchable
    status: pending
  - id: sql_cleanup
    content: Remove the dead [realUserId, anonUserId] params from the tag-link UPDATE in mergeAnonymousUserInto
    status: pending
  - id: preferences_decision
    content: Decide and implement whether anonymous UI preferences carry over to the real account on merge (open product question)
    status: pending
  - id: tests_verify
    content: Add regression coverage for the merge flow and run notes-next build/type-check/test
    status: pending
isProject: false
---

# Anonymous Merge — Correctness & Robustness Improvements

## Scope

These are the improvements around the anonymous→permanent account merge that stand
on their own, independent of how post-login data loading is orchestrated. The
client load-path race fix and the longer-term account model are in the separate
architecture plan: `anonymous_account_architecture_4d7e2b10.plan.md`. Apply that
plan's Phase 1 alongside these items; they are complementary and touch some of the
same handlers.

## Background

Anonymous visitors are backed by a real `user_v1` row with `is_anonymous = true`
plus real notes/categories/tags (no localStorage note storage). On sign-in, a signed
HMAC merge token proves browser ownership of the anonymous session, and
`mergeAnonymousUserInto` (`lib/db-marketing/sql/user/anonymous.ts`) moves the data
into the real account and deletes the anon row. The DB merge itself is sound; the
items below harden the surrounding behavior.

## 1. Flush pending autosaves before sign-in

Sign-out flushes before tearing down the session; login does not:

```1546:1549:apps/notes-next/src/components/notes/NotesApp.tsx
  const handleLogout = async () => {
    await flushPendingNoteSave()
    await signOut({ redirect: false })
```

`handleLogin` (`:1449`) and `handleSocialSignIn` (`:1521`) never call
`flushPendingNoteSave()`. Any edit still inside the 3s autosave debounce
(`NOTE_AUTOSAVE_DEBOUNCE_MS`) is never written to the anonymous account, so the merge
cannot move it — permanent loss for that last note.

**Change:** `await flushPendingNoteSave()` as the first statement in both
`handleLogin` and `handleSocialSignIn`, before any merge-token request or `signIn`
call. Update `apps/notes-next/AGENTS.md` "Note saving lifecycle" section to list
login among the flush triggers (currently it lists opening/creating notes,
back/forward, and sign-out).

## 2. Surface merge failures (no silent loss)

Today both login paths swallow merge errors:

```1506:1508:apps/notes-next/src/components/notes/NotesApp.tsx
        } catch {
          // Merge failure is non-fatal — anonymous data stays for cleanup
        }
```

If the token expired, the network blipped, or the anon row was already cleaned up,
the user lands on the real account with no indication their visitor work wasn't
transferred.

**Change:** when the merge call returns non-OK or throws, show a non-blocking,
recoverable message via the existing status/error banner (or a Gravity UI toast),
e.g. "Signed in, but we couldn't move your visitor notes. They're still saved — try
signing in again." Keep the real sign-in successful (do not roll it back); the
abandoned anon row remains eligible for the cleanup script. This applies wherever the
merge call ends up living (see the architecture plan for the single owner).

## 3. Embedding backfill after merge

The original design (`.cursor/plans/anonymous_sessions_26b7a04c.plan.md`, "Embedding
backfill after merge") specified running embedding maintenance after merge so newly
inserted categories/tags become searchable. It was never implemented —
`mergeAnonymousNotesAppSession` only runs the SQL:

```878:890:lib/db-marketing/services/notes-app.ts
export const mergeAnonymousNotesAppSession = async (request: {
  anonUserId: number;
  realUserId: number;
}): Promise<SessionResponse> => {
  await mergeAnonymousUserInto(request.anonUserId, request.realUserId);

  const user = await getUserById(request.realUserId);
  // ...
  return { user };
};
```

Category/tag rows inserted during merge bypass the service paths that generate Jina
embeddings, so they have `NULL` embeddings and won't appear in semantic search until
maintenance runs. (Notes keep their `description_embedding`, so they don't need a
backfill.)

**Change:** after the merge transaction commits, call
`maintainNoteEmbeddingsForNotesApp({ userId: realUserId, mode: "missing" })` for the
real user. Guard it so a missing `JINA_API_KEY` or a Jina error logs/degrades rather
than failing the whole merge (the merge must remain successful even if embedding
backfill can't run).

## 4. SQL cleanup (low priority)

The tag-link `UPDATE` in `mergeAnonymousUserInto` passes params it does not use:

```138:145:lib/db-marketing/sql/user/anonymous.ts
      await client.query(
        `UPDATE public.user_note_tag_link_v1 l
         SET tag_id = m.real_id
         FROM (VALUES ${tagValues}) AS m(anon_id, real_id)
         WHERE l.tag_id = m.anon_id`,
        [realUserId, anonUserId]
      );
```

The query references no `$1`/`$2`. **Change:** drop the unused
`[realUserId, anonUserId]` argument. Harmless but avoids confusion.

## 5. Anonymous preferences on merge (open product question)

Anonymous UI preferences (e.g. results column width) live on the anon `user_v1` row
and are discarded when it is deleted. `mergeAnonymousUserInto` does not copy
`preferences`.

**Decision needed:** carry anon preferences into the real account (ideally only when
the real account is still on defaults, so we don't overwrite a returning user's
settings), or intentionally drop them? If we carry them over, add a preferences-merge
step to `mergeAnonymousUserInto` (or the service wrapper) with the "only if real is
default" guard.

## 6. Tests & verification

- Add regression coverage for the merge flow where the harness allows mocking the
  session (there is currently no automated coverage of anonymous merge). At minimum:
  merge reassigns notes, dedupes categories/tags by label, and deletes the anon row.
- `pnpm --filter notes-next check-types`
- `pnpm --filter notes-next build`
- `pnpm --filter notes-next test`
- On Cursor Cloud, start Postgres and add pg17 to PATH before any `db:*` command (see
  root `AGENTS.md`).

## Files touched

| File | Change |
|------|--------|
| `apps/notes-next/src/components/notes/NotesApp.tsx` | Flush before login; merge-failure warning |
| `apps/notes-next/AGENTS.md` | Add login to the documented flush triggers |
| `lib/db-marketing/services/notes-app.ts` | Embedding backfill after merge; (optional) preferences carry-over |
| `lib/db-marketing/sql/user/anonymous.ts` | Drop dead query params; (optional) preferences carry-over |

## Cross-reference

The client race that causes the reported "visitor notes disappear on sign-in" symptom
is addressed in `anonymous_account_architecture_4d7e2b10.plan.md` (Phase 1). These
improvements should ship together with that phase.
