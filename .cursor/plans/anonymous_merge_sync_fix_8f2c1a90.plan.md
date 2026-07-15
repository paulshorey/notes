---
name: Anonymous Merge — Correctness & Robustness Improvements
overview: Supporting improvements around the anonymous→existing-account merge, independent of the load-path architecture rework (Phase 1, PR #61) and the claim-in-place signup (Phase 2, PR #63). All items are now complete — the flush and the basic merge-failure warning shipped with Phase 1; this plan's final pass added the embedding backfill, the preferences carry-over (per the product decision), two remaining silent-loss fixes in the client, and DB-backed regression tests that run in CI.
todos:
  - id: flush_before_login
    content: Await flushPendingNoteSave() at the start of handleLogin (and handleSignup) so in-flight/debounced anon edits are persisted before the session changes — SHIPPED in PR #61; handleSocialSignIn was removed with OAuth in PR #63
    status: completed
  - id: merge_failure_ux
    content: Surface a recoverable warning when merge fails instead of failing silently; keep the real sign-in successful. Basic warning shipped in PR #61; hardened here — token-capture failure aborts sign-in while still anonymous (when there are notes to lose), transient merge failures re-stash the token so a reload retries, permanent (4xx) failures warn without a false retry promise
    status: completed
  - id: embedding_backfill
    content: Run maintainNoteEmbeddingsForNotesApp({ mode "missing" }) for the real user after a successful merge so merged categories/tags are searchable — best-effort, never fails the merge
    status: completed
  - id: sql_cleanup
    content: Remove the extraneous [realUserId, anonUserId] params from the tag-link UPDATE in mergeAnonymousUserInto — found to be the TRUE ROOT CAUSE of all merges failing (Postgres rejects bind params a statement doesn't use, aborting the transaction); fixed and verified end-to-end
    status: completed
  - id: preferences_decision
    content: "Decision (product owner): carry anon preferences into the real account with a per-property merge, not a whole-JSON overwrite. Implemented as mergePreferenceObjects in mergeAnonymousUserInto — anon leaf values win (key presence = explicitly customized), real-only keys preserved"
    status: completed
  - id: tests_verify
    content: Added DB-backed regression coverage (testing/anonymous-merge.test.ts) run by `pnpm --filter @lib/db-notes test` against DB_NOTES_TEST_URL only (opt-in; never DB_NOTES_URL), wired into the CI verify-notes job; notes-next check-types/test/build pass
    status: completed
isProject: false
---

# Anonymous Merge — Correctness & Robustness Improvements

## Status: complete

All items in this plan have shipped. Items 1, 2 (basic warning), and 4 landed
with Phase 1 (PR #61). The remaining items — embedding backfill, preferences
carry-over, the last two silent-loss gaps, and regression tests — landed in the
final pass on branch `cursor/anonymous-merge-improvements-bc9b`.

## Background

Anonymous visitors are backed by a real `user_v1` row with `is_anonymous = true`
plus real notes/categories/tags. Since Phase 2 (PR #63) there are two paths to a
permanent account:

- **Claim-in-place (signup, common):** the anonymous row is upgraded in place —
  same `user_id`, no data movement, preferences survive automatically, no
  embeddings to backfill. Nothing in this plan applies to that path.
- **Merge (sign in to a pre-existing account, rare):** a signed HMAC merge token
  proves browser ownership of the anonymous session, and
  `mergeAnonymousUserInto` (`lib/db-notes/sql/user/anonymous.ts`) moves the
  data into the real account and deletes the anon row. This plan hardened that
  path.

## 1. Flush pending autosaves before sign-in — DONE (PR #61 / #63)

`handleLogin` and `handleSignup` both `await flushPendingNoteSave()` before any
token/claim request or `signIn` call. `handleSocialSignIn` no longer exists
(OAuth removed in Phase 2). `apps/notes-next/AGENTS.md` lists sign-in and signup
among the flush triggers.

## 2. Surface merge failures (no silent loss) — DONE

Phase 1 added the basic warning in `restoreSession`. Re-audit for this plan
found two remaining silent-loss gaps, both fixed here:

- **Token capture failure was silent:** if `POST /api/anon-session/merge-token`
  failed in `handleLogin`, sign-in proceeded with no token — the merge could
  never run, and after sign-in the anonymous session (and any path back to that
  data) is gone. Now, when the visitor has notes, a failed capture **aborts the
  sign-in** with an error while the user is still anonymous, so retrying
  actually works. An empty visitor session proceeds without a token (nothing to
  lose).
- **"Try signing in again" could never work:** the old warning suggested a
  retry, but the token had already been cleared and the anon session cookie was
  gone. Now transient merge failures (network error, 5xx) **re-stash the token**
  so the next `restoreSession` run — e.g. a page reload, within the token's
  10-minute TTL — retries the merge, and the message says to reload. Permanent
  failures (4xx: invalid/expired token, anon row already gone) keep the token
  cleared and show a plain warning. The real sign-in is never rolled back; an
  unmerged anon row remains eligible for the cleanup script.

## 3. Embedding backfill after merge — DONE

`mergeAnonymousNotesAppSession` (`lib/db-notes/services/notes-app.ts`) now
calls `maintainNoteEmbeddingsForNotesApp({ userId: realUserId, mode: "missing",
limit: 100 })` after the merge transaction commits, so categories/tags inserted
by the merge SQL (which bypass embed-on-write) become searchable. It is wrapped
in try/catch: a missing `JINA_API_KEY` or a Jina error logs a warning and the
merge stays successful. The regression test exercises exactly this degraded
path (no `JINA_API_KEY` set).

## 4. SQL fix — extraneous bind params aborted every merge — DONE (PR #61)

The tag-link `UPDATE` in `mergeAnonymousUserInto` passed bind params the
statement does not use; Postgres rejects that outright, aborting the entire
merge transaction. This was the root cause of the reported data loss (every
anonymous user is seeded with an `important` tag since commit `986d5a4`, so the
remap was never empty and every merge failed). Fixed and verified end-to-end in
PR #61. Recovery note: failed production merges left visitor data intact on
orphaned anonymous rows; it can be recovered by running the merge manually for
the affected pairs before the cleanup script removes them.

## 5. Anonymous preferences on merge — DECIDED & DONE

**Decision (product owner, Jul 2026):** carry anon preferences into the real
account, but never overwrite the real account's whole preferences JSON. Merge
per property: a value the anonymous user added or changed (i.e. non-default)
wins; everything else on the real account is preserved.

**Why per-property is checkable:** `user_v1.preferences` defaults to `{}` and
the client only writes a key when the user explicitly changes that setting
(e.g. dragging the results column writes `notesApp.resultsColumnWidth`). So key
presence = explicitly customized, key absence = still default. No ambiguity —
the "if unable to check default vs custom, re-think" escape hatch was not
needed.

**Implementation:** `mergePreferenceObjects` in
`lib/db-notes/sql/user/anonymous.ts` — recursive merge where anon leaf
values win and objects merge key-by-key; applied inside the merge transaction
(rows already locked `FOR UPDATE`) before the anon row is deleted. An anon row
with empty preferences leaves the real account untouched.

Note: this only matters for the merge path. The claim-in-place signup keeps the
same row, so preferences survive there automatically.

## 6. Tests & verification — DONE

- `lib/db-notes/testing/anonymous-merge.test.ts`: pure unit tests for
  `mergePreferenceObjects`, plus DB-backed regression tests asserting the merge
  reassigns notes (with category remap), dedupes categories/tags by label,
  remaps tag links, deletes the anon row, merges preferences per property, and
  succeeds without `JINA_API_KEY`.
- The DB suite is **opt-in via `DB_NOTES_TEST_URL`** and connects only to
  that URL — deliberately not `DB_NOTES_URL`, which in cloud/deployed
  environments points at the real Notes database. Without the variable the DB
  suite skips, so `turbo run test` stays green anywhere.
- `@lib/db-notes` gained a `test` script (node test runner via tsx). CI's
  `verify-notes` job runs it after `db:verify` against the job's throwaway
  migrated Postgres container.
- Verified locally against a fresh Postgres 17 + pgvector cluster: migrate →
  all tests pass; `check-types`, notes-next `test`, and `build` pass.

## Cross-reference

The client race that caused "visitor notes disappear on sign-in" was fixed in
`anonymous_account_architecture_4d7e2b10.plan.md` Phase 1 (PR #61); the
claim-in-place signup that removes the merge from the common path is Phase 2
(PR #63).
