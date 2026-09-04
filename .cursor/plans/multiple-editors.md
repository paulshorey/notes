---
name: Multiple Editors — concurrent in-memory notes with back, recent, and persistence
overview: Replace the single-note editor in `apps/notes-next` with a bounded, MRU-ordered ring of open notes held in memory simultaneously. Switching notes stops awaiting a save and becomes instant; each open note keeps its own draft, saved-signature, and save status. The ring survives a page reload, its size is a user preference (default 10), and the header gains a back button plus a recent dropdown with per-row close. The URL keeps mirroring the active note so links stay shareable.
todos:
  - id: open_notes_module
    content: "Add `src/stores/openNotes.ts` — pure, React-free types and reducers for the open-note ring (open, activate, goBack, close, evict, patch), taking the cap as an argument so they stay pure and testable under the existing node test runner"
    status: completed
  - id: store_slice
    content: "Move the seven per-note fields out of the flat `notesAppStore` into an `openNotes` entry list plus `activeKey`, `backStack`, and `nextDraftSequence`; replace the two bulk `useNotesAppStore()` destructures in `NotesApp` and `ResultsColumn` with selector subscriptions"
    status: completed
  - id: keyed_save_engine
    content: 'Rework `saveCurrentNote` into `saveEntry(key, mode)` — in-flight promises and queued autosaves keyed by entry, concurrent across notes, serialized per note, status write-back by key instead of by "is this still the open note"'
    status: completed
  - id: save_latency_client
    content: "Remove `refreshResults()` (three full list refetches) from the save path; merge the returned `NoteRecord` into `notes` in place, derive category and tag `noteCount` client-side, and relocate the category-fallback remap to where categories actually change"
    status: completed
  - id: save_latency_server
    content: "In `lib/db-notes`, skip the blocking Jina embedding round-trip on PATCH when the description is unchanged — the largest single component of save latency, and no schema change"
    status: completed
  - id: non_blocking_switch
    content: "Stop awaiting `flushPendingNoteSave()` when switching notes or starting a draft; fire a background save for the outgoing entry and activate the target immediately"
    status: completed
  - id: ring_and_eviction
    content: "Enforce the cap with LRU eviction; hand a dirty removed entry to a detached-save map so its request still completes and is still covered by the pagehide keepalive"
    status: completed
  - id: back_stack
    content: "Add a bounded visit-history stack so back walks backwards through visited notes rather than ping-ponging, self-healing over evicted, closed, and deleted keys"
    status: completed
  - id: max_open_notes_preference
    content: "Add `notesApp.maxOpenNotes` to `NotesAppPreferences` in the db-notes contract, regenerate the contract artifact, add clamped client helpers and a control in the user menu, and evict immediately when the cap is lowered"
    status: completed
  - id: persistence
    content: "Persist the ring to `localStorage` under its own key (separate from `notesCache`) with debounced writes, a pagehide flush, quota fallback, and reconciliation rules on rehydrate; clear it on logout, on session-restore failure, and after an anonymous merge"
    status: completed
  - id: header_ui
    content: "Add back and recent buttons to `NotesHeader` — recent opens a Gravity Popup listing open entries MRU-first with a derived title, category, per-entry save state, and a per-row close button"
    status: completed
  - id: url_and_sharing
    content: "Keep `?id=`, `?category=`, and `?tags=` mirroring the active entry via replaceState so links stay shareable; define the load-order rules where a URL note wins for activation but a persisted draft wins for content"
    status: completed
  - id: lifecycle_fanout
    content: "Update every path that assumes one open note — note delete, category and tag delete and rename, logout and session reset, URL sync, popstate, pagehide keepalive, and NoteForm and ResultsColumn props"
    status: completed
  - id: tests
    content: "Unit tests for the pure ring, back-stack, eviction, persistence-reconciliation, and headline helpers; manual verification of the switch-while-saving, evict-while-dirty, and reload-with-dirty-drafts races"
    status: completed
  - id: docs
    content: 'Rewrite the "Note saving lifecycle" section of `apps/notes-next/AGENTS.md` for the multi-entry model, document the persistence key and the preference, and remove the stale `FilterBanners.tsx` reference'
    status: completed
isProject: true
---

# Multiple Editors — concurrent in-memory notes

## Status: shipped (PR #69, merged 2026-09-01)

Implemented end to end and merged. File paths and line references below describe
the code as it was _before_ the change unless marked "new"; read the shipped
modules for current behavior.

The implementation diverged from this document in a few places worth knowing:

- There is no explicit `activateEntry` wrapper firing a save on switch. Switching
  relies on the per-entry autosave debounce in `useOpenNotesAutosave`.
- The per-entry `notePending` flag was dropped; sidebar moves register on
  `saveInFlightRef` instead.
- Note counts after a save come from a coalesced background taxonomy refetch
  (`TAXONOMY_REFRESH_DEBOUNCE_MS`, 4s) rather than being derived client-side.
- Reconciliation does not compare `baseTimeModified`; the field is recorded but
  unread, and every clean entry refreshes from the server record.
- Empty-draft cleanup lives inside the `activate` reducer rather than a separate
  deactivate handler.
- `test/note-headline.test.ts` was not added; `noteHeadline` lives in
  `src/lib/strings.ts`.

Follow-up work that reviewing this against the taxonomy plan turned up — two
silent data-loss paths in the shipped code — is recorded in
`notes_taxonomy_hierarchy_ef14c016.plan.md` sections 6.6a and 6.6b.

---

## 1. Goal and scope

### 1.1 What we are building

`apps/notes-next` will hold several notes open in memory at once. Opening a note
adds it to a bounded, most-recently-used list rather than replacing whatever was
open, and switching between open notes is instant because it no longer waits for
a save.

Confirmed product requirements:

| #   | Requirement                                                                                                   | Section    |
| --- | ------------------------------------------------------------------------------------------------------------- | ---------- |
| R1  | Multiple notes live in memory and state simultaneously; opening a note adds to the list rather than replacing | §3         |
| R2  | Switching notes does not wait for the previous note to save                                                   | §4.3       |
| R3  | The list is bounded; adding past the limit drops the least recently used entry                                | §3.4       |
| R4  | No tab bar. A **back** button and a **recent** dropdown instead                                               | §8.1, §8.2 |
| R5  | Selecting from the recent dropdown opens that note and promotes it to the top                                 | §8.2       |
| R6  | The open list survives a page reload                                                                          | §6         |
| R7  | The limit is a user preference, defaulting to 10                                                              | §7         |
| R8  | The recent dropdown offers an explicit per-row close                                                          | §8.3       |
| R9  | The URL keeps carrying the active note id and category so links stay shareable                                | §9         |

### 1.2 Explicitly out of scope

- **Fully asynchronous embedding.** Deferring the Jina call to a job queue is a
  larger `@lib/db-notes` design change with its own consistency and backfill
  implications. §5.2 does the contained part instead.
- **Cross-tab ring synchronization.** Two browser tabs each keep their own ring
  and race on the shared `localStorage` key with last-writer-wins. This matches
  the existing last-write-wins behavior of note content itself. §14.
- **`history.pushState` per note switch.** §9.4 explains why.
- **Per-entry cursor and undo-history restore.** §10 records the trade-off and
  the two follow-up options.

---

## 2. Why the current architecture blocks this

### 2.1 One editor slot

`notesAppStore` holds a single `noteForm` and a single `editingNoteId`, and
`NotesApp` holds a single `lastSavedNoteDraftRef` / `noteSavePromiseRef` pair.
Because there is one slot, opening a second note destroys the first one's
draft — so the code must persist it first, and it does so by blocking:

```ts
// src/components/notes/NotesApp.tsx — handleStartEdit
const handleStartEdit = async (note: NoteRecord) => {
  if (editingNoteIdRef.current !== note.id) {
    await flushPendingNoteSave()   // the stall the user feels
  }
  ...
}
```

The same awaited gate sits in front of `handleCancelEdit` (header `jot.new`,
the `+` button, and the cancel `X`), `handleAddNoteForCategory`,
`handleAddNoteForTag`, and the `popstate` handler.

### 2.2 The save that gate waits on is slow

Two compounding costs:

**Three list refetches per save.** `saveCurrentNote` ends with
`await refreshResults(currentUser.id)`, which refetches all notes, all
categories, and all tags. A note switch therefore costs four HTTP round-trips.

**A blocking embeddings call before the write.** Both create and update await a
Jina HTTP round-trip _before_ Postgres is touched:

```ts
// lib/db-notes/services/notes-app.ts:792
export const updateNoteForNotesApp = async (request: UpdateNoteRequest) => {
  const embeddings = await createNoteEmbeddingInput({
    description: request.note.description,
  })
  const note = await updateNoteForUser(request.noteId, request.userId, request.note, embeddings)
  return note ? { note } : null
}
```

`createNoteEmbeddingInput` (`lib/db-notes/services/notes-embeddings.ts:131`)
calls `fetchEmbeddings`, an external `fetch` with a 30-second timeout. There is
no cache and no diff check, so a category-only edit still pays for a full
re-embed.

### 2.3 Consequence

Both must be fixed. Making switching non-blocking without fixing latency would
put several notes on a 3-second autosave debounce, each costing four round-trips
plus an embedding call — worse than today, not better.

---

## 3. Data model

### 3.1 The entry

New module `apps/notes-next/src/stores/openNotes.ts`, holding pure types and
reducers with no React and no Zustand import, so it is directly unit-testable.

```ts
/** Stable identity for an open entry. Survives the note's first save. */
export type OpenNoteKey = string // `note:${id}` for saved notes, `draft:${n}` for new ones

export interface OpenNoteEntry {
  key: OpenNoteKey
  /** null while this entry is a new note that has never been persisted. */
  noteId: number | null
  /** Live in-memory draft — the moved `noteForm`. */
  form: NoteFormState
  /** Moved `lastSavedNoteDraftRef`, now per entry. */
  savedSignature: string | null
  /** Moved `noteSaveStatus`, now per entry. */
  saveStatus: NoteSaveStatus
  /** Moved `descriptionEditorSessionId`, now per entry. */
  editorSessionId: number
  /** Moved `categoryInputValue`. */
  categoryInputValue: string
  /** Moved `pendingTagLabels`. */
  pendingTagLabels: string[]
  /** Moved `editorRevealText`; cleared once it fires. */
  revealText: string | null
  /** Moved `editorAutofocus`. */
  autofocus: boolean
  openedAt: number
  lastActivatedAt: number
}
```

### 3.2 The store slice

`notesAppStore` gains four fields and loses seven.

**Moving out of the flat store into each entry:** `noteForm`, `editingNoteId`,
`noteSaveStatus`, `descriptionEditorSessionId`, `pendingTagLabels`,
`categoryInputValue`, `editorAutofocus`.

**Moving in from `NotesApp` local state:** `editorRevealText` (a `useState`) and
`lastSavedNoteDraftRef` (a ref, becoming the per-entry `savedSignature`).

**Staying flat**, because they are genuinely app-wide: `resultsListVisible`,
`manuallyExpandedCategoryId`, `selectedTagId`, `searchQuery`.

```ts
openNotes: OpenNoteEntry[]      // MRU-ordered, index 0 = most recently activated
activeKey: OpenNoteKey | null
backStack: OpenNoteKey[]        // visit history, most recent last, bounded
nextDraftSequence: number       // mints `draft:${n}` keys
```

Thin memoized selectors keep the rest of the app readable: `selectActiveEntry`,
`selectActiveForm`, `selectActiveSaveStatus`, `selectRecentEntries`,
`selectBackTarget`, `selectHasBackgroundSaveActivity`, `selectOpenNoteIds`.

### 3.3 Why a key rather than the note id

A brand-new note has `noteId === null` until its first save returns an id. If
identity were the note id, that first save would change the entry's identity and
therefore its editor `documentId`, remounting CodeMirror mid-typing. A
`draft:${n}` key stays stable across the transition and `noteId` is filled in —
the same trick the current code performs inline with `editingNoteIdRef` inside
`saveCurrentNote`, generalized and made explicit.

Two small choices at this point are worth making with §15 in mind, since they
are free now and awkward later: typing the address rather than hardcoding
`number`, and storing the loaded record's `timeModified` on the entry.

**Carry over one subtlety.** `serializeNoteDraft(noteId, form)` includes the note
id, so an entry's `savedSignature` must be recomputed with the newly assigned id
when the first save lands, exactly as
`lastSavedNoteDraftRef.current = serializeNoteDraft(savedNoteId, formSnapshot)`
does today. Miss this and the entry looks permanently dirty and autosaves in a
loop.

### 3.4 Reducers

All pure, all in `openNotes.ts`, all unit-tested. Every reducer that can remove
an entry returns `{ state, removed: OpenNoteEntry[] }` so the caller can route
dirty removals to the detached-save path (§4.4).

The cap is passed in as an argument rather than read from a module constant,
because it is a user preference (§6) and the reducers must stay pure.
`MAX_OPEN_NOTES_DEFAULT = 10`.

| Operation                                          | Behavior                                                                                                                                                                                                                                          |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `openExistingNote(state, note, cap)`               | If an entry for `note.id` exists, activate and promote it to index 0 and **keep its in-memory draft** — do not reload from the server record. Otherwise create an entry from `noteToFormState(note)`, then insert → activate → evict (see below). |
| `openNewDraft(state, { categoryId, tagIds }, cap)` | If the active entry is already an empty draft, no-op — see below. Otherwise mint `draft:${nextDraftSequence}`, then insert → activate → evict.                                                                                                    |
| `activate(state, key)`                             | Push the outgoing `activeKey` onto `backStack`, set `activeKey`, promote the entry to index 0, bump `lastActivatedAt`.                                                                                                                            |
| `goBack(state)`                                    | Pop keys off `backStack` until one still exists in `openNotes`, then activate it **without** pushing the outgoing key back on.                                                                                                                    |
| `closeEntry(state, key)`                           | Remove from `openNotes`, purge every occurrence from `backStack`. If it was active, activate the back target, else the new index 0, else open a fresh draft. Returns the removed entry.                                                           |
| `evictToCap(state, cap)`                           | While `openNotes.length > cap`, drop the last entry that is not the active one. Returns all dropped entries.                                                                                                                                      |
| `patchEntry(state, key, patch)`                    | The single write path for form, status, and signature updates, used by both the UI and save completions. No-op if the key is gone.                                                                                                                |

**Eviction protects only the active entry.** Also protecting the current back
target is tempting but can make the cap unenforceable when the back target _is_
the LRU candidate. It is unnecessary anyway: `goBack` pops until it finds a
surviving key, so the stack self-heals over evictions, closes, and deletions.

**The open sequence is insert → activate → evict, in that order, and the order
is load-bearing.** Because eviction protects the active entry, evicting before
activating protects the _outgoing_ entry instead of the incoming one. At
`cap === 1` that deadlocks the cap outright: the list holds two entries, the
only eviction candidate is the still-active outgoing entry, so nothing can be
dropped and the cap is silently violated. Activating first makes the incoming
entry the protected one and the outgoing entry the candidate, which is what we
want at every cap. Test this at `cap === 1` specifically — larger caps hide it.

**Opening a new draft while the active entry is already an empty draft is a
no-op.** Otherwise pressing `+` repeatedly mints throwaway entries that push
real notes out of the ring. "Empty" is the existing `newNoteHasUserInput`
predicate in `NoteForm`, inverted. This pairs with the deactivate-time cleanup
in §14: one rule stops empty drafts being created, the other stops them
lingering.

**Back is a visit stack, not "MRU index 1".** Those differ. With MRU-index-1
semantics, pressing back twice returns you to where you started, because the
first press promotes the target to index 0. A real stack lets back walk
A → B → C → back → B → back → A. Back never pushes, which is what keeps the walk
monotonic. `backStack` is bounded at `cap * 2` entries so a long session cannot
grow it without limit.

---

## 4. Save engine

### 4.1 Keyed, concurrent

`saveCurrentNote(mode)` becomes `saveEntry(key, mode)`:

- The synchronous pre-`await` snapshot stays — it is load-bearing — but it
  snapshots **that entry**, not `noteFormRef.current`.
- `noteSavePromiseRef: Promise<void> | null` becomes
  `saveInFlight: Map<OpenNoteKey, Promise<void>>`. Saves for different entries
  run concurrently; a second save for the _same_ entry keeps today's rules — an
  `autosave` marks itself queued and returns, a `flush` awaits the in-flight
  save then re-checks the signature.
- `queuedAutosaveRef: boolean` becomes `Set<OpenNoteKey>`.
- Completion write-back keys off the entry rather than "is this still the note
  the editor is showing". This guard —

  ```ts
  const stillEditingSavedNote =
    editingNoteIdRef.current === noteId || (noteId === null && editingNoteIdRef.current === null)
  ```

  — exists only because state is global. With per-entry state it collapses to
  `patchEntry(key, { savedSignature, saveStatus, noteId })`, which is correct
  whether or not the user has moved on.

- Modes are `autosave | flush | detached`. A `detached` save persists an entry
  that has already left the ring (§4.4) and never touches store state. There is
  no manual mode — see below.
- `notePending` is a single `useState` boolean that gates the autosave effect and
  is set during sidebar moves. It must become per-entry, or a sidebar move on one
  note suppresses autosave on every other open note. Derive it from the entry
  rather than adding a parallel map.

**Manual save mode is already gone.** It was removed on this branch ahead of the
refactor, because it was unreachable dead code whose behavior would have been
wrong here. `saveCurrentNote("manual")` ended by calling `resetNoteForm(...)`,
which clears the editor back to a blank draft; there was no submit control to
trigger it, since no descendant of `NoteForm`'s `<form>` had `type="submit"`.
Ported into the ring model that would have recycled the ring slot holding the
just-saved note into an empty draft, dropping the note out of the recent list
while the user was still working in it. The `<form>` element remains for
grouping and styling, with an `onSubmit` that only calls `preventDefault()` so
Enter in an expanded date field cannot implicitly submit and reload the page.

If a Save button is ever wanted, the behavior it should have is "persist now,
leave the entry open" — never a reset.

### 4.2 Autosave fan-out

The single debounce effect becomes one debounce **per dirty entry**, in a new
`src/hooks/useOpenNotesAutosave.ts` holding a `Map<OpenNoteKey, timeoutId>`. On
every `openNotes` change: for each entry whose live signature differs from its
`savedSignature` and which passes today's "non-empty description and a category"
guards, re-arm a 3-second trailing timer; clear timers for entries that went
clean or disappeared.

Only the active entry receives keystrokes, so in practice at most one timer is
ever repeatedly re-armed. Background entries fire once and go clean.

### 4.3 Non-blocking switching

```ts
const activateEntry = (key: OpenNoteKey) => {
  const outgoing = activeKeyRef.current
  if (outgoing && outgoing !== key) void saveEntry(outgoing, "autosave") // fire, don't await
  store.activate(key)
}
```

The outgoing draft is safe because it is still in `openNotes`. If its request
fails, its entry shows `error` in the recent dropdown and the autosave hook
retries on the next change.

### 4.4 Removal of a dirty entry

Removal — by eviction (§3.4), by explicit close (§8.3), or by lowering the cap
(§7.4) — is the one place a draft genuinely leaves memory, so all three route
through one path. The reducer returns the removed entries; for each removed
entry that is dirty, `NotesApp` moves `{ noteId, form, signature }` into a
`detachedSaves: Map<OpenNoteKey, DetachedSave>` ref and calls
`saveEntry(key, "detached")`, deleting the map entry on success. That gives us:

- The entry vanishes from the dropdown immediately, with no zombie UI state.
- The request still completes.
- The `pagehide` / `visibilitychange` keepalive iterates `detachedSaves` **and**
  `openNotes`, so an abrupt tab close still persists both.

**Duplicate-note hazard.** A never-saved entry (`noteId === null`) saves with
`POST`, so two overlapping saves for the same key create two notes. Two guards,
both required:

- A detached save must not start while `saveInFlight` already holds that key.
  Chain onto the in-flight promise instead, then re-check the signature — the
  in-flight save may already have persisted the snapshot, and it is the one that
  learns the new `noteId`.
- A queued autosave must not be dispatched until the completing save has written
  `noteId` back to the entry, or the queued run still sees `null` and `POST`s a
  second note. Today's ordering already does this — the write-back happens
  inside the save promise and the queued run is dispatched after it — so the
  requirement is to preserve that ordering, not to invent it. It is easy to lose
  when the write-back moves from `setEditingNoteId` to `patchEntry`.

Because a detached entry has no store slot, the `noteId` a detached `POST`
returns has nowhere to go. That is fine — nothing will reference it again — but
it does mean a detached save must never be retried, or it creates a second note.
Delete the map entry on completion whether it succeeded or failed, and rely on
the keepalive for the failure case.

### 4.5 Flushes that must stay awaited

Non-blocking switching does not mean deleting `flush`. These paths still await,
now over **all dirty entries** via `Promise.allSettled`:

- `handleLogin` — must persist before the anonymous merge token is captured, or
  the outgoing draft never reaches the DB and the merge cannot move it.
- `handleSignup` — must persist before the claim flips the row.
- `handleLogout` — must persist before the session is torn down and `openNotes`
  and the persisted snapshot are cleared.

The `popstate` handler no longer needs to flush: the target note is already in
memory with its own draft, so applying the URL selection is non-destructive.

---

## 5. Save latency

Two halves, independently shippable. Together they take a note switch from four
round-trips plus an embedding call down to one round-trip that no longer blocks
the UI at all.

### 5.1 Client — stop refetching everything after every save

Replace the trailing `refreshResults` with an in-place merge of the record the
API already returns. `POST` and `PATCH /api/notes` both respond
`{ note: NoteRecord }` with the category and tags nested, so nothing else is
needed to update the list:

```ts
setNotes((prev) => [...prev.filter((n) => n.id !== data.note.id), data.note])
```

Four things `refreshResults` was silently providing must be replaced. The last
two are the easy ones to miss, because nothing fails loudly when they go —
the UI just shows stale text later.

- **`CategoryRecord.noteCount` and `TagRecord.noteCount`.** These come from
  correlated `COUNT(*)` subqueries in `lib/db-notes/sql/category.ts` and
  `sql/tag.ts` and are display-only. Derive them client-side from `notes` —
  `ResultsColumn` already groups notes by category and by tag, so each count is
  one `.length` away. Fallback if deriving proves fiddly: a **coalesced**
  background `refreshResults`, one trailing timer shared by all saves at roughly
  5 seconds, rather than one refetch per save.
- **The category fallback remap** inside `refreshResults`:

  ```ts
  setNoteForm((prev) => prev.selectedCategoryId still exists ? prev : { ...prev, selectedCategoryId: getDefaultCategoryId(latest) })
  ```

  This must now map over **every** entry in `openNotes`, and it belongs where
  categories actually change (create, delete, merge) rather than on the save
  path. Extract it as `remapEntriesAfterCategoryChange(categories)` and reuse it
  from the delete, rename, and rehydrate paths (§6.4).

- **The search-results refresh.** `refreshResults` ends with
  `if (trimmedSearchQuery) await runSearch(...)`. The standalone search effect
  cannot cover this, because it is keyed on `[notes.length, trimmedSearchQuery, user]`
  and editing a note does not change `notes.length` — so with a search active,
  an edited note would keep showing its pre-edit text in the results list. Do
  **not** re-run the search on every save; that costs an embedding call for the
  query plus a vector scan. Patch the matching entry inside `searchResults` in
  place, the same way `notes` is patched, and leave the similarity score alone.

- **The `notesCache` notes-list write.** `updateNotesCacheList(userId, "notes", …)`
  lives inside `loadNotes`, so dropping the refetch also stops the local snapshot
  being refreshed after a save. The next cold start would paint pre-edit text
  until the background revalidate lands. Call `updateNotesCacheList` with the
  merged array after the in-place merge.

### 5.2 Server — do not re-embed an unchanged description

The largest single component of save latency, and contained.
`updateNoteForNotesApp` currently embeds unconditionally, even when only the
category, tags, or a date changed — which is exactly what a sidebar move or a
due-date edit does.

- Read the stored row first: a local Postgres round-trip, cheap next to an
  external embeddings call. Fetch `description`, `description_embedding IS NULL`,
  and `embedding_model`.
- Skip `createNoteEmbeddingInput` and pass a sentinel meaning "leave the
  embedding columns alone" only when **all three** hold:
  1. the normalized description is unchanged;
  2. `description_embedding IS NOT NULL`;
  3. `embedding_model` equals `CURRENT_NOTE_EMBEDDING_MODEL`.
- Widen `updateNoteForUser` (`lib/db-notes/sql/note/update.ts:10`) to accept
  `NoteEmbeddingWriteInput | null` and omit `description_embedding`,
  `embedding_model`, and `embedding_updated_at` from the `SET` list when null.

**Why all three conditions, not just the first.** Skipping on an unchanged
description alone would strand two populations of notes that ordinary editing
currently repairs as a side effect. Notes with a null embedding — a create whose
Jina call failed, or a row inserted by the anonymous-merge SQL, which bypasses
embed-on-write — would stay unsearchable no matter how much the user edited
their category or tags. Notes embedded with a superseded model would stop
migrating when `CURRENT_NOTE_EMBEDDING_MODEL` is bumped. Conditions 2 and 3
mirror exactly what `listNotesStaleEmbeddingsByUser` treats as needing work
(`embedding_model IS DISTINCT FROM $2 OR description_embedding IS NULL`), so the
skip fires only when the stored embedding is already correct and current.

**Checked and clear:** staleness detection does _not_ compare
`embedding_updated_at` against `time_modified` (`lib/db-notes/sql/note/gets.ts:49`).
So leaving `embedding_updated_at` behind while `time_modified` advances does not
create phantom stale rows for the maintenance job. Had the query used a
timestamp comparison, this optimization would have quietly created work rather
than saving it.

**Also preserved:** clearing an embedding still works. When a description is
edited to empty, `createNoteEmbeddingInput` returns `emptyEmbeddingInput()` and
the three columns are nulled. That path is a description _change_, so condition
1 fails and the skip correctly does not apply.

This touches no table definition and no contract, so per the repo database rules
it needs no migration and no `verify-contract.mjs` change. Run `pnpm run db:verify`
deliberately before merge anyway, and extend the DB-backed suite
(`pnpm --filter @lib/db-notes test` against `DB_NOTES_TEST_URL`) to cover the
skip, the re-embed, the null-embedding repair, the model-mismatch repair, and
the edit-to-empty clear.

---

## 6. Persistence across reloads (R6)

### 6.1 Its own storage key, deliberately

The ring is persisted under `notes-open-notes-v1`, **separate** from the existing
`notes-app-cache-v1` in `src/lib/notesCache.ts`. Three concrete reasons, each of
which would otherwise cause data loss or a hot-path regression:

1. **Different durability class.** `notesCache` is a discardable
   stale-while-revalidate cache of server data. Open notes contain _unsaved user
   text_. `notesCache` discards itself wholesale once
   `CACHE_MAX_AGE_MS` (14 days) has passed, and `clearNotesCache()` is called on
   the `restoreSession` failure path (`NotesApp.tsx:980`). Either would silently
   destroy unsaved drafts.
2. **Different write frequency.** `updateNotesCacheList` rewrites the entire
   snapshot JSON on every list fetch. Drafts change on keystrokes. Sharing one
   blob means each rewrites the other's data on a hot path.
3. **Independent versioning and independent quota failure.** A quota error while
   writing drafts must not take down the server-data cache, and vice versa.

### 6.2 Persisted shape

```ts
interface OpenNotesSnapshot {
  schemaVersion: 1
  userId: number
  activeKey: OpenNoteKey | null
  backStack: OpenNoteKey[]
  nextDraftSequence: number
  entries: PersistedEntry[]
  savedAt: number
}
```

`PersistedEntry` carries `key`, `noteId`, `form`, `savedSignature`,
`categoryInputValue`, `pendingTagLabels`, `openedAt`, and `lastActivatedAt`.

Dropped on purpose:

- `editorSessionId` — restarts at 0 on a fresh page.
- `revealText` — must not re-fire a search highlight after a reload.
- `autofocus` — recomputed from the current layout.
- `saveStatus` — a persisted `saving` is a lie after a reload; recompute by
  comparing the live signature against `savedSignature`.

Validation on read mirrors the defensive `isSnapshot` style already in
`notesCache.ts`: reject on malformed JSON, `schemaVersion` mismatch, or
`userId` mismatch.

### 6.3 Write policy

- A 1-second trailing debounce on changes to `openNotes`, `activeKey`, or
  `backStack`. Never write on every keystroke — `JSON.stringify` plus a
  synchronous `localStorage` write on the main thread is exactly the kind of
  jank this whole plan exists to remove.
- An immediate synchronous write inside the existing `pagehide` /
  `visibilitychange` handler, alongside the keepalive save.
- On `QuotaExceededError`: retry once persisting only dirty entries. If that
  also fails, persist the ring shape with clean entries' `form.description`
  blanked (they reload from the server record anyway) and surface an error.
  **Never silently drop a dirty draft.**

### 6.4 Rehydration and reconciliation

Runs inside `restoreSession` once notes are available. It has to run **twice**,
because `restoreSession` has two branches that both produce notes.

On a warm start the cache-first branch paints from `readNotesCache` and only
then awaits `fetchFreshSession`, which replaces `notes` without re-running
`applyNotesUrlSelection`. Reconciling only against the cached list would judge
entries against a snapshot up to 14 days old — a note deleted server-side last
week would still look present, and a note edited on another device would look
current. Reconciling only after the fresh fetch would throw away the fast paint
that the cache exists to provide.

So: reconcile once against the cached list for the immediate paint, then again
after the fresh load. The second pass is safe to repeat because the rules are
idempotent and dirty entries are never touched by either pass — only the clean
refresh and the record-missing cases can change anything, and both converge on
the fresh data. Guard the _first_ pass with a ref so it cannot run twice within
a branch; the second pass is a deliberate re-run, not a duplicate.

Per entry with a `noteId`:

| Server state                       | Entry clean                                                                                       | Entry dirty                                                                                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Record present, unchanged          | Keep as-is                                                                                        | Keep the local draft                                                                                                                         |
| Record present, server is newer    | Refresh the form from the record, recompute `savedSignature` from it, and reset `editorSessionId` | **Keep the local draft** — the user's unsaved text always wins, matching today's last-write-wins on save                                     |
| Record missing (deleted elsewhere) | Drop silently — nothing is lost                                                                   | Keep the text by converting to a `draft:` entry (`noteId → null`) and show a status message naming the count, so the next save re-creates it |

The dirty-and-deleted rule deserves its rationale: it can resurrect a note the
user deliberately deleted in another tab. That is the lesser evil, because the
alternative is destroying text the user typed and never saw saved. The status
message makes it visible rather than silent.

**Any write to an entry's form during reconciliation must recompute
`savedSignature` alongside it.** This is the same failure as the draft-key
signature issue in §3.3, and it shows up in three places here: refreshing a
clean entry from a newer server record, remapping dead category and tag ids, and
re-keying after an anonymous merge. Leave the old signature in place and the
entry reads as dirty the instant it loads, so the autosave hook immediately
PATCHes the server with what the server just told us — harmless in the simple
case, but on the merge path it would push anonymous-side ids back over the
merged ones. The rule to hold: a form change the _user_ did not make is never
allowed to make an entry dirty.

Other rules:

- Entries with `noteId: null` — never-saved drafts — are kept when the
  description is non-empty and dropped when empty.
- No max-age expiry for dirty entries; unsaved text does not go stale. Clean
  entries older than 90 days by `lastActivatedAt` are dropped, which loses
  nothing since they reload from the server on demand.
- Category and tag ids in a restored form that no longer exist are remapped to
  the default category and filtered, reusing
  `remapEntriesAfterCategoryChange` from §5.1.
- The URL selection is applied **on top** of the rehydrated ring (§9.2).

### 6.5 Clearing, and the anonymous transitions

- `handleLogout` — clear after the awaited flush.
- The `restoreSession` catch and reset path — clear; the session is invalid.
- **Claim-in-place (create account).** The user id does not change and no notes
  move, so the ring survives untouched. No action needed, but assert it in
  testing — it is the common signup path.
- **Merge (sign in to an existing account).** This one needs care, because the
  merge treats the three tables differently. `MERGE_TABLE_STRATEGIES` in
  `lib/db-notes/sql/user/anonymous.ts` registers `user_note_v1` as `reparent`
  but `user_note_category_v1` and `user_note_tag_v1` as `dedup-remap`. So:
  - **Note ids survive** the merge — only `user_id` changes — which means
    persisted `note:${id}` keys stay valid.
  - **Category and tag ids do not survive.** A restored entry's
    `selectedCategoryId` and `selectedTagIds` may point at anonymous-side ids
    that no longer exist.
  - **The user id changes**, so the `userId` gate in §6.2 rejects the
    anon-keyed snapshot on read by default. That is safe — `handleLogin`
    already awaits a full flush before capturing the merge token, so no text is
    lost — but it silently discards the _list_ of which notes were open.

  Recommended behavior: after a successful merge, re-key the snapshot's `userId`
  to the real user id instead of clearing it, then let the §6.4 reconciliation
  pass repair the dead category and tag ids through
  `remapEntriesAfterCategoryChange`. The user keeps their open notes across
  sign-in. If that proves fiddly, clearing is the acceptable fallback and loses
  only the list, never the text — but do one or the other deliberately rather
  than leaving it to the `userId` gate by accident.

---

## 7. The `maxOpenNotes` preference (R7)

### 7.1 Contract change and the build gate

`NotesAppPreferences` in `lib/db-notes/contracts/notes-app.ts` gains
`maxOpenNotes?: number`, joining the existing `markdownEditorMode`,
`resultsColumnWidth`, and `pasteUrlAsMarkdown`.

This is a **contract** change, not a schema change:

- `user_v1.preferences` is JSONB and the server's `parseUserPreferences` accepts
  any JSON object, so there is **no migration** and no `verify-contract.mjs`
  update.
- `lib/db-notes/generated/contracts/notes-app.json` **must** be regenerated with
  `pnpm --filter @lib/db-notes app:contract:generate`. `app:contract:check` runs
  inside both `notes-next`'s `check-types` and its `build`, so the build fails
  until this is done. Commit the regenerated artifact with the change.
- **No Android change is required.**
  `apps/notes-android/tools/validate-notes-contract.mjs` validates only
  `UserSummary`, `TagRecord`, `NoteRecord`, and `SemanticSearchResult`, and
  Kotlin's `NotesAppPreferences` already omits `pasteUrlAsMarkdown` and
  `markdownEditorMode`. Adding another optional field will not break the APK
  build.

### 7.2 Client plumbing

Mirror the existing `resultsColumnWidth` pair in `NotesApp.tsx` exactly:
`getMaxOpenNotesPreference(preferences)` and
`withMaxOpenNotesPreference(preferences, value)`, clamped to 1–25 with a default
of 10. The existing 500 ms debounced `PATCH /api/session` picks the change up
with no new request plumbing.

Anonymous users get this for free: `mergeAnonymousUserInto` carries preferences
across with a per-property merge where the anonymous value wins, so a cap set
before signing in survives.

### 7.3 UI

A small Gravity `Select` in the user-menu `Popup` in `NotesHeader.tsx`, beside
the existing "Paste URLs as markdown links" checkbox. Label it for what it does
— "Keep N notes open" — rather than exposing the internal name.

### 7.4 Lowering the cap must evict immediately

Easy to miss. When the preference drops from 10 to 3, call `evictToCap` at once
and route any dirty removals through the detached-save path (§4.4). Do not wait
for the next note to be opened.

---

## 8. UI

No tab bar. Two icon buttons join the `NotesHeader` left cluster beside
`jot.new` and `SaveStatusIndicator`.

### 8.1 Back (R4)

`ArrowLeft` from `@phosphor-icons/react`, already a dependency. Disabled when
`backStack` has no surviving target. The `title` names the destination so the
button is not a mystery: `Back to "Quarterly planning notes"`.

### 8.2 Recent (R4, R5)

`ClockCounterClockwise`, opening a Gravity `Popup` — the same pattern as the
existing user menu in `NotesHeader` and the note action menus in
`ResultsColumn`:

```tsx
<Popup anchorRef={recentBtnRef} open={recentOpen} onClose={close} placement="bottom-start" offset={6}>
```

Contents: `openNotes` in MRU order, each row showing

- **a derived title.** Do not write a third title helper. Two already exist:
  `noteHeadline`, private to `NoteResultsList.tsx` (first line, punctuation
  stripped, truncated to 100 characters, `Untitled` fallback), and
  `firstLineLabel` in `src/lib/strings.ts` (strips whitespace too, used only for
  aria-labels in `ResultsColumn`). Promote `noteHeadline` into
  `src/lib/strings.ts`, have `NoteResultsList` import it from there, and reuse it
  here. It takes a `NoteRecord` today and must accept a raw description string
  instead, because a `draft:` entry has no record;
- the category label as secondary text;
- a per-entry save state dot reusing the `SAVE_STATUS_LABELS` vocabulary from
  `NotesHeader.tsx`;
- a close button (§8.3);
- the active row marked with `aria-current` and not clickable-to-nothing.

No filter input: at most a couple of dozen rows, so a plain `Popup` is right and
`FilterablePickerPopup` would be over-built. Keyboard: arrow keys move, `Enter`
activates, `Delete` or `Backspace` closes the focused row, `Escape` closes the
popup and returns focus to the trigger.

Selecting a row calls `activateEntry(key)`, which promotes it to the top of the
MRU list (R5).

### 8.3 Per-row close (R8)

An `X` button nested inside each row. Because the row itself is clickable, the
close button must `stopPropagation` — the existing `noteAction` wrapper in
`ResultsColumn` is the precedent to copy.

Behavior:

- Closing a **dirty** entry routes through the detached-save path (§4.4), so the
  text is still persisted after the row disappears. Closing is not discarding.
- Closing the **active** entry activates the back target, else the new index 0,
  else opens a fresh empty draft. This is already `closeEntry`'s contract.
- The entry leaves the persisted snapshot on the next debounced write.
- `aria-label` is `Close "<title>"`.

### 8.4 Sidebar

Mark **open** notes in `ResultsColumn` with a treatment distinct from the
**active** highlight — for example a left rule versus the existing filled row.
Without it the ring is invisible from the place users actually pick notes, and
"why does this note already show my unsaved text" becomes surprising. This is a
small CSS-module addition plus passing `selectOpenNoteIds` alongside the existing
`activeNoteId`.

### 8.5 Mobile

Both buttons are icon-only and sit in the existing header row, which already
collapses the search field on narrow screens. The recent popup should be
width-capped and scrollable. Check it against the 720px breakpoint
(`MOBILE_RESULTS_MEDIA_QUERY`) during implementation.

---

## 9. URL, sharing, and history (R9)

### 9.1 What stays

`?id=`, `?category=`, and `?tags=` keep mirroring the **active** entry through
`writeNotesUrlSelection` and `replaceState`, unchanged in mechanism. This is a
requirement, not an incidental behavior: a user must be able to copy the address
bar and open that note in another browser or hand it to someone else.

The whole ring is deliberately **not** encoded in the URL. A shared link should
open one note, not dump the sender's entire session onto the recipient.

### 9.2 Load order

The rule is: **the URL decides which entry is active; persistence decides what
each entry contains.**

1. Rehydrate the ring from `localStorage` and reconcile it against loaded notes
   (§6.4).
2. If `?id=` names a note:
   - already in the ring → activate it, **keeping its restored draft**;
   - not in the ring → open it and activate it, evicting to the cap if needed.
3. If there is no `?id=` → activate the persisted `activeKey` when it survived,
   else index 0, else open a fresh draft.
4. `?category=` and `?tags=` with no `?id=` seed a **new draft**, as today.

The recipient of a shared link therefore keeps their own ring intact; the shared
note is simply added and activated.

### 9.3 What `popstate` does now

Nothing needs flushing — the target note is already in memory with its own
draft — so the handler just activates the entry named by the URL, opening it
first if the ring does not have it.

### 9.4 Why not `pushState` per switch

Wiring note switches to `history.pushState` so the browser and Android back
gestures drive `goBack` is attractive: one history model, and free hardware-back
support on the PWA. It is rejected for now because it changes global navigation
behavior — every note switch becomes a history entry, so leaving the app would
take N back presses — and it couples the feature to `popstate` ordering. The
in-store `backStack` is deterministic and unit-testable. Revisit separately.

---

## 10. Editor integration

**One mounted `AtomicEditor`, driven by the active entry.** Ten live CodeMirror
views would be expensive and pointless when only one is visible.

`AtomicEditor` (`src/components/editor/AtomicEditor.tsx`) forwards `documentId`
to `AtomicCodeMirrorEditor` and uses `markdownSource` only at mount, so swapping
documents means changing `documentId`:

```tsx
<AtomicEditor
  documentId={`${activeEntry.key}:${activeEntry.editorSessionId}`}
  value={activeEntry.form.description}
  initialRevealText={activeEntry.revealText}
  autofocus={activeEntry.autofocus}
  onUpdate={(description) => patchEntry(activeEntry.key, { description })}
/>
```

Switching entries changes `documentId`, which remounts the view seeded from that
entry's **in-memory** draft, unsaved text included. `editorSessionId` remains the
escape hatch for forcing a reset within the same entry, which is what
`bumpDescriptionEditorSessionId` does today.

**Known trade-off.** A remount discards CodeMirror's cursor position, selection,
scroll offset, and undo history for the note being left. The text is safe; the
editing context is not. Acceptable for a first version. Two follow-ups if it
proves annoying: capture a per-entry cursor offset through `editorHandleRef` on
deactivate and restore it on activate, or cache a CM6 `EditorState` per entry,
which would need a new prop on the fork in `lib/atomic-editor`.

`revealText` becomes per-entry and is cleared once it fires; otherwise returning
to a note opened from a search result re-triggers the scroll-and-highlight every
time.

---

## 11. Audit: every single-note assumption

This is the bulk of the diff surface in `NotesApp.tsx`.

| Location                                                                                | Required change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `handleStartEdit` / `handleOpenNoteFromResults`                                         | Drop the awaited flush; call `openExistingNote` then `activateEntry`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `handleCancelEdit`, `handleAddNoteForCategory`, `handleAddNoteForTag`                   | Open a **new draft entry** instead of resetting the one global form. Behavior change — see §14.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `handleDeleteNote`                                                                      | `closeEntry` for that note whether or not it is active, rather than only calling `resetNoteForm` when it happens to be the open one, and purge it from `backStack`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `handleMoveNoteCategory` / `handleMoveNoteTag`                                          | These currently patch `noteForm` when `editingNoteId === note.id`; they must patch the entry for that note if it is open, active or not.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `handleCreateTag` / `handleCreateCategory`                                              | **Capture the entry key before the `await`.** Both `POST`, then on response call `setNoteForm` / `setPendingTagLabels` / `setCategoryInputValue` against whatever is current. Non-blocking switching makes "whatever is current" a different note: type a new tag in note A, switch to B while the request is in flight, and the tag lands on B. Resolve the target key up front and complete through `patchEntry(key, …)`. `creatingTagLabelsRef` stays global — deduping concurrent creates of the same label across entries is exactly what it is for — but `pendingTagLabelsRef` becomes per-entry, so the `shouldKeepSelected` check must read the captured entry. |
| `refreshResults` category remap                                                         | Fan out across all entries and relocate off the save path (§5.1).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `performDeleteCategory*`, `performDeleteTag`, `handleSaveCategory`, `handleSaveTag`     | Remap or clear affected `selectedCategoryId`, `selectedTagIds`, and `categoryInputValue` across all entries.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `handleLogout`, `resetDefaultState`, the `restoreSession` error path                    | Clear `openNotes`, `activeKey`, `backStack`, `detachedSaves`, and the persisted snapshot.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `applyNotesUrlSelection`                                                                | Follow the §9.2 load order; never clobber a restored or in-memory draft when the URL points at an already-open note.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `popstate` handler                                                                      | No flush; activate the entry named by the URL (§9.3).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `pagehide` / `visibilitychange` keepalive                                               | Iterate all dirty entries plus `detachedSaves`, and write the persistence snapshot (§6.3).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `ResultsColumn` `activeNoteId` / `activeCategoryId` / `activeTagIds`                    | Read from the active entry; add the open-note set (§8.4).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `NoteForm` props                                                                        | `form`, `setForm`, `editingNoteId`, `descriptionEditorSessionId`, `categoryInputValue`, and `pendingTagLabels` all become active-entry-derived. `notePending` is declared in `NoteFormProps` but never destructured — delete it.                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `notePending`                                                                           | A single boolean gating the autosave effect, now set only by sidebar moves. Must become per-entry (§4.1), or one note's sidebar move suppresses autosave on every other open note.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `useNotesAppStore()` bulk destructures — `NotesApp.tsx:396` and `ResultsColumn.tsx:132` | Both subscribe to the entire store, so any `openNotes` write would re-render the whole app including the editor. Convert to selector subscriptions. Mandatory, not a nicety.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

---

## 12. Phases

Six phases, each independently reviewable, each leaving the app working.

### Phase 1 — Slice extraction at a cap of 1

**Deliverables.** `src/stores/openNotes.ts` with types and reducers; the store
slice; `NotesApp`, `NoteForm`, and `NotesHeader` reading through the active
entry; selector subscriptions replacing the two bulk destructures.

**Already done on this branch.** Manual save mode was deleted ahead of the
refactor (§4.1), so Phase 1 starts from a save engine with two modes rather than
porting an unreachable third.

**Acceptance.** No user-visible behavior change at all. `pnpm --filter notes-next verify`
passes. A manual pass covers open, edit, autosave, cancel, delete, switch, and
reload.

**Why first.** This is the risky mechanical refactor, isolated from every
behavior change so a regression here is unambiguous.

### Phase 2 — Keyed save engine

**Deliverables.** `saveEntry(key, mode)`; `Map`-based in-flight tracking;
per-entry status write-back; the `detached` mode and `detachedSaves` map;
`useOpenNotesAutosave`.

**Acceptance.** Still one entry, so still no behavior change. Unit tests for the
extractable save-engine reducers pass.

### Phase 3 — Save latency

**Deliverables.** Client-side in-place `NoteRecord` merge with client-derived
`noteCount` (§5.1); the server-side re-embed skip in `lib/db-notes` (§5.2).

**Acceptance.** A note switch is measurably faster in the network panel — one
request instead of four, and no Jina call on a category-only edit. DB-backed
tests cover both embedding branches. `pnpm run db:verify` passes.

**Note.** Worth shipping as its own PR. It makes the current single-note app
faster on its own, so it delivers value even if later phases slip.

### Phase 4 — Multi-entry

**Deliverables.** The cap raised past 1 with `evictToCap`; non-blocking
switching; the back stack; dirty removals routed to detached saves.

**Acceptance.** Behavior changes here. Manual checks 1, 2, 3, 6, and 12 in §13
pass; the reload and preference checks wait for Phase 5.

### Phase 5 — Persistence and the preference

**Deliverables.** `src/lib/openNotesStorage.ts` (new) with the snapshot read,
write, and clear helpers; debounced writes and the `pagehide` flush;
rehydration and reconciliation; `maxOpenNotes` in the contract plus the
regenerated artifact; the client preference helpers and the user-menu control;
evict-on-lower.

**Acceptance.** Drafts survive a reload. Lowering the cap evicts immediately and
saves dirty removals. `pnpm --filter notes-next build` passes with the
regenerated contract, and the Android APK build still passes contract
validation.

### Phase 6 — UI

**Deliverables.** Back and recent buttons; per-row close; per-entry save state;
the promoted `noteHeadline`; the sidebar open-note treatment.

**Acceptance.** Keyboard navigation works as specified in §8.2. A manual pass on
the 720px breakpoint.

---

## 13. Testing

`apps/notes-next` runs `node --import tsx --test ./test/*.test.ts` with **no DOM
or React testing setup**, and none should be added. That constraint is exactly
why the ring logic goes in a pure module.

### Unit tests

`test/open-notes.test.ts` — the reducers. Cases worth naming:

- opening an already-open note preserves its draft and promotes it;
- exceeding the cap evicts the LRU and returns it as dropped;
- eviction never drops the active entry;
- the cap holds even when the LRU is the current back target;
- `goBack` walks A→B→C→B→A rather than toggling;
- `goBack` skips evicted, closed, and deleted keys;
- `closeEntry` on the active entry falls back to the back target, then index 0,
  then a fresh draft;
- deleting a note closes its entry and purges it from the stack;
- a `draft:` entry keeps its key across the `noteId: null` → real id transition,
  and its signature is recomputed with the new id;
- lowering the cap evicts down to it and returns every dropped entry;
- **`cap === 1`: opening a second note leaves exactly one entry.** This is the
  case that catches an insert → evict → activate ordering mistake; every larger
  cap passes even with the order wrong (§3.4);
- `openNewDraft` while the active entry is an already-empty draft is a no-op and
  does not consume a draft sequence number.

`test/open-notes-storage.test.ts` — serialization and reconciliation, as a pure
function over `(snapshot, notes)`:

- a malformed, wrong-version, or wrong-user snapshot is discarded;
- a clean entry whose server record is newer is refreshed from the record;
- a dirty entry whose server record is newer keeps the local draft;
- a clean entry whose record is gone is dropped;
- a dirty entry whose record is gone becomes a `draft:` entry and is reported;
- an empty never-saved draft is dropped, a non-empty one is kept;
- a form referencing a deleted category is remapped to the default;
- **no reconciliation outcome leaves a clean entry dirty.** Assert it as a
  blanket invariant over every case above rather than one case at a time: for
  any entry the user did not edit, the returned `savedSignature` matches the
  returned `form`. This is the cheapest guard against the §6.4 signature bug,
  and it keeps holding as new reconciliation rules are added;
- reconciling twice in a row produces the same result as reconciling once,
  which is what makes the cached-then-fresh double pass safe.

`test/note-headline.test.ts` — the promoted `noteHeadline`: heading markers,
punctuation, empty and whitespace-only documents, the truncation boundary.

In `lib/db-notes`, extend the DB-backed suite to cover all five branches of the
re-embed skip (§5.2): a category-only PATCH on a correctly-embedded note skips
and leaves `embedding_updated_at` untouched; a description change re-embeds; a
note with a null embedding is repaired even when the description is unchanged; a
note whose `embedding_model` is superseded is re-embedded; and editing a
description to empty still nulls all three columns.

### Manual verification

These are races unit tests will not catch:

1. Type in note A, switch to B before A's save lands, switch back to A. A shows
   the typed text and reads `saved`, with no lost keystrokes.
2. Open past the cap with the first entry still dirty. Its save completes even
   though it left the dropdown — verify in the network panel and by reloading.
3. Kill the tab with three dirty entries. All three persist through keepalive.
4. Reload with three dirty entries. All three come back with their unsaved text,
   and the one named by `?id=` is active.
5. Delete a note in a second tab while a dirty draft for it is open in the first,
   then reload the first. The text survives as a new draft and the message says
   so.
6. Delete the active note with others open. Focus moves to a sensible entry and
   no orphan is left in the dropdown.
7. Sign out with several dirty entries. All flush before the session tears down
   and the persisted snapshot is cleared.
8. Create an account (claim path) with several entries open. The ring survives.
9. Sign in to an existing account (merge path) with several entries open, where
   at least one open note sits in a category that also exists on the target
   account. The entries survive re-keyed, their categories and tags resolve to
   the merged ids rather than dangling, and no phantom entries remain.
10. Lower the cap from 10 to 3 with dirty entries beyond the new limit. They are
    evicted and their saves complete.
11. Copy the URL with a note open, paste it into another browser profile. That
    one note opens and is active.
12. Rename and delete a category while notes in it are open. Every affected entry
    updates.
13. Start typing a brand-new note, then switch away before its first save
    returns, then switch back and keep typing. Exactly one note exists at the
    end — this is the duplicate-`POST` hazard in §4.4.
14. Type a new tag name in note A, switch to B before the tag request returns.
    The tag lands on A, not B. Repeat for a newly created category.
15. Reload as a returning user with a warm `notesCache`, having edited one of the
    open notes on another device since. The cached paint appears immediately and
    the entry updates to the newer server text once the fresh load lands, without
    the entry ever showing as unsaved (§6.4).
16. With a search query active, edit an open note that appears in the results.
    The results row updates rather than showing pre-edit text (§5.1).

---

## 14. Risks and mitigations

| Risk                                                                                                                                                                                                                                                                                                                                                              | Mitigation                                                                                                                                                                                                                              |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Phase 1 is the real risk.** `NotesApp.tsx` is roughly 2,500 lines and the save lifecycle is subtle — the synchronous pre-`await` snapshot, the `lastSavedNoteDraftRef` dedupe, the `editingNoteIdRef` write-back, and the keepalive path all interlock.                                                                                                         | Phase 1 ships at a cap of 1 with zero behavior change, so any regression is unambiguous. The existing correctness comments in that file are load-bearing documentation — read them before moving anything and carry them across.        |
| **Silent data loss.** Every eviction, close, non-awaited switch, and reload is a place a draft can vanish.                                                                                                                                                                                                                                                        | One removal path through `detachedSaves` (§4.4); a widened keepalive; a persistence layer that never drops a dirty entry (§6.3); the dirty-and-deleted resurrect rule (§6.4). Manual checks 1–5 are not optional.                       |
| **`jot.new` and `+` change meaning** from "replace the open note" to "add a draft alongside it", making abandoned empty drafts easy to accumulate.                                                                                                                                                                                                                | Close a draft entry that is deactivated while still empty, reusing the existing `newNoteHasUserInput` predicate in `NoteForm`.                                                                                                          |
| **Async handlers completing against the wrong entry.** A whole class of bug that does not exist today: any handler that `await`s and then writes "the current form" will write to whichever note is active when the response lands. `handleCreateTag` and `handleCreateCategory` are the two known cases, and the save engine's completion write-back is a third. | Capture the entry key before the first `await` and complete through `patchEntry(key, …)`. Treat "reads or writes the active entry after an await" as a review checklist item for this whole change, not just for the three known sites. |
| **A non-user form change silently making an entry dirty**, causing an immediate autosave that pushes stale data back to the server. Most dangerous on the merge path, where it would overwrite merged category and tag ids with anonymous-side ones.                                                                                                              | Recompute `savedSignature` on every non-user write (§6.4), and assert the invariant across all reconciliation cases in `test/open-notes-storage.test.ts` rather than case by case.                                                      |
| **Autosave storms.** Several entries on a 3-second debounce could in principle fire concurrent requests.                                                                                                                                                                                                                                                          | Only the active entry receives edits, so background entries fire once and go clean. Phase 3 cuts per-save cost from four round-trips plus an embedding call to one round-trip. Watch it during Phase 4 anyway.                          |
| **Re-render cost.** The two bulk `useNotesAppStore()` destructures mean every `openNotes` write would re-render the whole app, editor included.                                                                                                                                                                                                                   | Selector subscriptions in Phase 1, listed as a deliverable rather than a cleanup.                                                                                                                                                       |
| **localStorage quota.** Many long notes plus the existing full-notes cache could exceed the budget.                                                                                                                                                                                                                                                               | Debounced writes, a dirty-only retry, then a description-blanking fallback for clean entries, and an error surfaced rather than a silent drop (§6.3).                                                                                   |
| **Two tabs share one storage key** and will overwrite each other's ring.                                                                                                                                                                                                                                                                                          | Out of scope by decision (§1.2). Last-writer-wins matches the existing behavior for note content. Each tab's in-memory ring stays correct for that tab; only the persisted copy races.                                                  |
| **The contract change gates the build.** `app:contract:check` runs in `notes-next`'s `check-types` and `build`.                                                                                                                                                                                                                                                   | §7.1 makes regenerating `generated/contracts/notes-app.json` an explicit Phase 5 deliverable, and confirms no Android change is needed.                                                                                                 |

---

## 15. Forward look: a future move from database records to files

Recorded because it may happen later, not because it is being designed now.
Nothing below changes the scope of this plan. The question it answers is narrow:
does anything here make a later switch from "a note is a row" to "a note is a
file in a repository" significantly harder? Short answer, no — and two parts of
this design actively help.

### 15.1 What already points the right way

- **The key/address split (§3.3).** `OpenNoteKey` is opaque and stable while
  `noteId` is a mutable field on the entry. That split exists because a new
  note's id changes from `null` to a real value on first save, but it
  generalizes exactly: a file's identity is its path, and paths change on rename
  and move. The ring slot is already built to survive its address changing.
- **The `draft:` versus `note:` distinction.** An entry with no address is
  precisely an editor's unsaved untitled buffer. That is the same model a
  file-backed editor needs, arrived at for unrelated reasons.
- **Reconcile-on-activate (§6.4).** Pull-based today, but it is the natural seam
  for a file watcher to push into later. External change handling has somewhere
  to live.
- **A bounded ring itself.** A codebase has thousands of files and cannot be held
  in memory. "A small set of open documents, everything else addressed lazily" is
  the shape a file-backed editor requires, and this plan moves toward it.

### 15.2 Storage-agnostic either way

Persistence (§6) is hot-exit and becomes _more_ valuable with files; the
mechanism is unchanged. Detached saves, the keepalive, the back stack, the
recent dropdown, and the size preference care nothing about the backing store.
The §5 latency work becomes less necessary — a local write has no network and no
embedding call — but the in-place record merge matters more, not less, since
re-reading a tree after every save is worse than re-reading a table.

### 15.3 Cheap now, annoying later

- **Reconciliation should take a lookup, not the corpus.** Specify it as
  `(ref) => Record | undefined` rather than a `notes` array. Equivalent today,
  and it keeps the whole-corpus assumption out of a pure, unit-tested module.
- **§5.1's client-derived `noteCount` cuts against this.** Deriving counts from
  the full in-memory `notes` array deepens the assumption that every note is
  loaded — `listNotesByUser` has no `LIMIT` and `notesCache` stores all of
  them. The coalesced background refresh listed there as the fallback is the more
  portable option. Worth choosing with eyes open rather than by default.
- **Type the address, don't hardcode its shape.** `noteId: number | null`
  encodes "integer minted by a server". A `NoteRef` alias costs nothing.

### 15.4 Rules that are database-specific and must be revisited

- **The dirty-and-deleted resurrect rule (§6.4).** With a database, a record only
  disappears because someone deliberately deleted it, so keeping the user's
  unsaved text as a new note is the kind choice. With files, things disappear
  constantly and impersonally — `git checkout`, a branch switch, a stash, a
  rebase. Recreating a file there means fighting version control and restoring
  exactly what the user just checked away from. This rule inverts under files.
- **Silent autosave of an addressless draft (§4.2).** Against a database this is
  free: the server mints an id and nothing is visible until the user looks.
  Against a filesystem, creating means choosing a path, and background-writing
  derived filenames would litter the working tree and `git status`. The guard
  would likely become "do not autosave an entry with no address".

### 15.5 The one genuinely expensive gap

**There is no optimistic concurrency anywhere in this app today.**
`updateNoteForUser` is `UPDATE … WHERE id = $1 AND user_id = $2` with no
version predicate, and no route sends or checks an `If-Match`. Every write is
last-write-wins. This plan does not make that worse in kind, but it does multiply
the number of concurrent background writers from one to the cap.

Against a database the blast radius is bounded: you can only clobber your own
note, usually with your own slightly older text. Against files it is not. A
background save firing seconds after you switched away can overwrite a file that
git, a formatter, or another agent just rewrote — destroying work this app never
authored.

Retrofitting is expensive not because of the plumbing (a base revision on
`UpdateNoteRequest`, a `time_modified` predicate in the `WHERE`, a 409 in the
route) but because of the UX: with several notes open, a conflict can land on an
entry the user is not looking at, and "what does a background conflict look
like" is a design problem rather than a wiring problem.

Do not build it now. Do the free half: when an entry is created or refreshed from
a record, store that record's `timeModified` on the entry as its base revision.
`NoteRecord` already carries the field, so it costs one property and no contract
change. It makes the §6.4 "server is newer" comparison explicit instead of
implied, and the day `If-Match` arrives the client already holds the value to
send.

### 15.6 The real obstacle is elsewhere

The largest barrier to a file-backed version is not in this plan: the app assumes
the entire corpus is in memory. `listNotesByUser` has no pagination, `notesCache`
persists every note, and search is a server-side vector scan over all rows.
Category and tag ids as foreign keys would also have to become folders and
frontmatter, which reaches `NoteFormState`, the URL parameters, and the sidebar
grouping. All of that is pre-existing. This plan neither worsens it nor fixes it,
with the single exception noted in §15.3.
