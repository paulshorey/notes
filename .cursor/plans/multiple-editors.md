---
name: Multiple Editors — concurrent in-memory notes with back + recent
overview: Replace the single-note editor in `apps/notes-next` with a bounded, MRU-ordered ring of up to 10 open notes held in memory simultaneously. Switching notes stops awaiting a save and becomes instant; each open note keeps its own draft, saved-signature, and save status. The header gains a "back" button and a "recent" dropdown (no tab bar). Includes the save-latency work that makes concurrent autosaving affordable.
todos:
  - id: open_notes_module
    content: Add `src/stores/openNotes.ts` — pure, React-free types and reducers for the open-note ring (open/activate/goBack/close/evict/patch) so the logic is unit-testable under the existing node test runner with no DOM
    status: pending
  - id: store_slice
    content: Move the seven per-note fields out of the flat `notesAppStore` into an `openNotes` entry list plus `activeKey`/`backStack`/`nextDraftSequence`, and replace the two bulk `useNotesAppStore()` destructures in NotesApp and ResultsColumn with selector subscriptions
    status: pending
  - id: keyed_save_engine
    content: Rework `saveCurrentNote` into `saveEntry(key, mode)` — in-flight promises and queued autosaves keyed by entry, concurrent across notes, serialized per note, status write-back by key instead of by "is this still the open note"
    status: pending
  - id: save_latency_client
    content: Remove `refreshResults()` (three full list refetches) from the save path; merge the returned NoteRecord into `notes` in place, derive category/tag noteCount client-side, and relocate the category-fallback remap to where categories actually change
    status: pending
  - id: save_latency_server
    content: In `lib/db-notes`, skip the blocking Jina embedding round-trip on PATCH when the description is unchanged — the single biggest component of save latency, and no schema or contract change
    status: pending
  - id: non_blocking_switch
    content: Stop awaiting `flushPendingNoteSave()` when switching notes or starting a draft; fire a background save for the outgoing entry and activate the target immediately
    status: pending
  - id: ring_and_eviction
    content: Cap the ring at 10 with LRU eviction; hand a dirty evicted entry to a detached-save map so its request still completes and is still covered by the pagehide keepalive
    status: pending
  - id: back_stack
    content: Add a bounded visit-history stack so "back" walks backwards through visited notes rather than ping-ponging, self-healing over evicted and deleted keys
    status: pending
  - id: header_ui
    content: Add "back" and "recent" buttons to NotesHeader — recent opens a Gravity Popup listing open entries MRU-first with a derived title, category, and per-entry save state; selecting one activates and promotes it
    status: pending
  - id: lifecycle_fanout
    content: Update every path that assumes one open note — note delete, category/tag delete and rename, logout and session reset, URL sync, popstate, pagehide keepalive, and NoteForm/ResultsColumn props
    status: pending
  - id: tests
    content: Unit tests for the pure ring, back-stack, eviction, and headline helpers; manual verification of the switch-while-saving and evict-while-dirty races
    status: pending
  - id: docs
    content: Rewrite the "Note saving lifecycle" section of `apps/notes-next/AGENTS.md` for the multi-entry model and remove its stale `FilterBanners.tsx` reference
    status: pending
isProject: true
---

# Multiple Editors — concurrent in-memory notes

## Status: proposed (not started)

Planning only. Nothing has been implemented. Every file path and line reference
below describes current code unless it is marked "new".

## 1. The problem, precisely

`apps/notes-next` keeps exactly **one** note in editable state. `notesAppStore`
holds a single `noteForm` and a single `editingNoteId`; `NotesApp` holds a
single `lastSavedNoteDraftRef` / `noteSavePromiseRef` pair. Because there is
only one slot, opening a second note has to destroy the first one's draft — so
the code must persist it first, and it does so by blocking:

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

That await is slow for two compounding reasons:

1. **`flushPendingNoteSave` waits on `refreshResults`.** `saveCurrentNote` ends
   with `await refreshResults(currentUser.id)`, which refetches **all** notes,
   **all** categories, and **all** tags. So a note switch costs four HTTP
   round-trips, not one.
2. **The write itself blocks on an embeddings API call.** Every create and
   update awaits a Jina HTTP round-trip *before* Postgres is touched:

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
   calls `fetchEmbeddings`, an external `fetch` with a 30-second timeout. There
   is no cache, no queue, and no diff check — an update re-embeds even when the
   description did not change.

So there are two independent problems, and both need fixing:

- **Structural.** One editor slot, so switching is destructive and must be
  ordered after a successful save.
- **Latency.** Each save is far slower than it needs to be. Even with
  non-blocking switching, ten notes autosaving on a 3-second debounce while
  every save triggers three list refetches plus an embedding call would be
  worse than what we have now, not better.

## 2. Target model

A bounded, MRU-ordered **ring of open entries**. Each entry owns everything
that is a single global field today.

### 2.1 Entry shape

New module `apps/notes-next/src/stores/openNotes.ts` — pure types and reducers,
no React and no Zustand, so it is directly unit-testable:

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

### 2.2 Store shape

`notesAppStore` gains four fields and loses seven. The seven that move into the
entry are `noteForm`, `editingNoteId`, `noteSaveStatus`,
`descriptionEditorSessionId`, `pendingTagLabels`, `categoryInputValue`, and
`editorAutofocus`. Two more per-note values move in from `NotesApp` local
state: `editorRevealText` (a `useState`) and `lastSavedNoteDraftRef` (a ref,
becoming `savedSignature`). Everything else in the store —
`resultsListVisible`, `manuallyExpandedCategoryId`, `selectedTagId`,
`searchQuery` — is genuinely app-wide and stays flat.

```ts
openNotes: OpenNoteEntry[]      // MRU-ordered, index 0 = most recently activated
activeKey: OpenNoteKey | null
backStack: OpenNoteKey[]        // visit history, most recent last
nextDraftSequence: number       // mints `draft:${n}` keys
```

`MAX_OPEN_NOTES = 10`, a hard cap: adding an 11th entry always drops one.

Thin memoized selectors keep the rest of the app readable: `selectActiveEntry`,
`selectActiveForm`, `selectActiveSaveStatus`, `selectRecentEntries`,
`selectBackTarget`, `selectHasBackgroundSaveActivity`.

### 2.3 Why a key rather than the note id

A brand-new note has `noteId === null` until its first save returns an id. If
identity were the note id, that first save would change the entry's identity
and therefore its editor `documentId`, remounting CodeMirror mid-typing. A
`draft:${n}` key stays stable across the transition and `noteId` is simply
filled in — the same trick the current code performs inline with
`editingNoteIdRef` inside `saveCurrentNote`, generalized and made explicit.

One consequence to carry over carefully: `serializeNoteDraft(noteId, form)`
includes the note id, so an entry's `savedSignature` **must** be recomputed
with the newly assigned id when the first save lands, exactly as
`lastSavedNoteDraftRef.current = serializeNoteDraft(savedNoteId, formSnapshot)`
does today. Miss this and the entry looks permanently dirty and autosaves in a
loop.

### 2.4 Reducers

All pure, all in `openNotes.ts`, all unit-tested.

| Operation | Behavior |
| --- | --- |
| `openExistingNote(state, note)` | If an entry for `note.id` exists, activate and promote it to index 0 and **keep its in-memory draft** (do not reload from the server record). Otherwise create an entry from `noteToFormState(note)`, insert at index 0, evict if over cap. |
| `openNewDraft(state, { categoryId, tagIds })` | Mint `draft:${nextDraftSequence}`, insert at index 0, evict if over cap. |
| `activate(state, key)` | Push the outgoing `activeKey` onto `backStack`, set `activeKey`, promote the entry to index 0, bump `lastActivatedAt`. |
| `goBack(state)` | Pop keys off `backStack` until one still exists in `openNotes`, then activate it **without** pushing the outgoing key back on. |
| `closeEntry(state, key)` | Remove from `openNotes`, purge every occurrence from `backStack`. If it was active, activate the back target, else the new index 0, else open a fresh draft. |
| `evictIfNeeded(state)` | While `openNotes.length > MAX_OPEN_NOTES`, drop the last entry that is not the active one. Returns the dropped entries so the caller can hand dirty ones to the detached-save map. |
| `patchEntry(state, key, patch)` | The single write path for form, status, and signature updates, used by both the UI and save completions. No-op if the key is gone. |

**Eviction protects only the active entry.** Protecting the back target as well
would be tempting, but it can make the cap unenforceable when the back target
*is* the LRU candidate, and it is unnecessary: `goBack` already pops until it
finds a surviving key, so the stack self-heals over evictions.

**Back semantics are a visit stack, not "MRU index 1".** Those differ. With
MRU-index-1 semantics, pressing back twice returns you to where you started,
because the first press promotes the target to index 0. A real stack lets back
walk A → B → C → back → B → back → A. Back never pushes, which is what keeps
the walk monotonic. `backStack` is bounded at `MAX_OPEN_NOTES * 2` entries so
it cannot grow without limit during a long session.

## 3. Save engine

### 3.1 Keyed, concurrent, non-blocking

`saveCurrentNote(mode)` becomes `saveEntry(key, mode)`:

- The synchronous pre-`await` snapshot stays — it is load-bearing — but it
  snapshots **that entry**, not `noteFormRef.current`.
- `noteSavePromiseRef: Promise<void> | null` becomes
  `saveInFlight: Map<OpenNoteKey, Promise<void>>`. Saves for different entries
  run concurrently; a second save for the *same* entry keeps today's rules (an
  `autosave` marks itself queued and returns, a `flush` awaits the in-flight
  save then re-checks the signature).
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
- Modes become `manual | autosave | flush | detached`. A `detached` save
  persists an entry that has already left the ring (§3.3) and never touches
  store state.

### 3.2 Autosave fan-out

The single debounce effect becomes one debounce **per dirty entry**, in a new
`src/hooks/useOpenNotesAutosave.ts` holding a `Map<OpenNoteKey, timeoutId>`. On
every `openNotes` change: for each entry whose live signature differs from its
`savedSignature` and which passes today's "non-empty description and a
category" guards, re-arm a 3-second trailing timer; clear timers for entries
that went clean or disappeared.

Only the active entry receives keystrokes, so in practice at most one timer is
ever repeatedly re-armed. Background entries fire once and go clean.

### 3.3 Switching, and eviction of a dirty entry

Switching stops awaiting:

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

Eviction is the one place a draft genuinely leaves memory, so it needs care.
`evictIfNeeded` returns the dropped entries; for each dropped entry that is
dirty, `NotesApp` moves `{ noteId, form, signature }` into a
`detachedSaves: Map<OpenNoteKey, DetachedSave>` ref and calls
`saveEntry(key, "detached")`, deleting the map entry on success. That gives us:

- The entry vanishes from the dropdown immediately, with no zombie UI state.
- The request still completes.
- The `pagehide` / `visibilitychange` keepalive iterates `detachedSaves`
  **and** `openNotes`, so an abrupt tab close still persists both.

### 3.4 Flushes that must stay awaited

Non-blocking switching does not mean deleting `flush`. These paths still await,
now over **all dirty entries** via `Promise.allSettled`:

- `handleLogin` — must persist before the anonymous merge token is captured,
  or the outgoing draft never reaches the DB and the merge cannot move it.
- `handleSignup` — must persist before the claim flips the row.
- `handleLogout` — must persist before the session is torn down and
  `openNotes` is cleared.

The `popstate` handler no longer needs to flush at all: the target note is
already in memory with its own draft, so applying the URL selection is
non-destructive.

## 4. Save latency

Without this section, ten notes autosaving is a downgrade rather than an
upgrade. There are two halves, and they are independently shippable.

### 4.1 Client: stop refetching everything after every save

Today every save ends with three full list fetches. Replace that with an
in-place merge of the record the API already returns — `POST` and `PATCH
/api/notes` both respond `{ note: NoteRecord }` with the category and tags
nested, so nothing else is needed to update the list:

```ts
setNotes((prev) => [...prev.filter((n) => n.id !== data.note.id), data.note])
```

Two things `refreshResults` was silently providing have to be replaced:

- **`CategoryRecord.noteCount` and `TagRecord.noteCount`.** These come from
  correlated `COUNT(*)` subqueries in `lib/db-notes/sql/category.ts` and
  `sql/tag.ts`, and are only used for sidebar display. Derive them client-side
  from `notes` — `ResultsColumn` already groups notes by category and by tag,
  so the counts are one `.length` away. If deriving turns out to be fiddly, the
  fallback is a **coalesced** background `refreshResults`: one trailing timer
  shared by all saves, around 5 seconds, instead of one refetch per save.
- **The category fallback remap** inside `refreshResults`:

  ```ts
  setNoteForm((prev) => prev.selectedCategoryId still exists ? prev : { ...prev, selectedCategoryId: getDefaultCategoryId(latest) })
  ```

  This must now map over **every** entry in `openNotes`, and it belongs where
  categories actually change (create, delete, merge) rather than on the save
  path.

### 4.2 Server: do not re-embed an unchanged description

This is the single largest component of save latency and it is a contained
change in `lib/db-notes`. `updateNoteForNotesApp` currently embeds
unconditionally, even when only the category, tags, or a date changed — which
is exactly what a sidebar move or a due-date edit does.

Proposed change:

- Read the stored description first (a local Postgres round-trip, cheap
  compared with an external embeddings call).
- If the normalized description is unchanged, skip `createNoteEmbeddingInput`
  entirely and pass a sentinel meaning "leave the embedding columns alone".
- Widen `updateNoteForUser` (`lib/db-notes/sql/note/update.ts:10`) to accept
  `NoteEmbeddingWriteInput | null` and omit `description_embedding`,
  `embedding_model`, and `embedding_updated_at` from the `SET` list when null.

This touches no table definition and no generated contract, so per the
repo-root database rules it needs no migration and no `verify-contract.mjs`
update — but `pnpm run db:verify` should still be run deliberately before
merge, and `lib/db-notes` has DB-backed tests
(`pnpm --filter @lib/db-notes test` against `DB_NOTES_TEST_URL`) that should
cover both the skip and the re-embed branch.

Deliberately **not** in scope: making embedding fully asynchronous (a job
queue, or writing the note first and embedding after). That is a larger
`@lib/db-notes` design change with its own consistency and backfill
implications, and it is not a prerequisite for this feature.

## 5. Editor integration

**One mounted `AtomicEditor`, driven by the active entry.** Ten live CodeMirror
views would be expensive and pointless when only one is visible.

`AtomicEditor` (`src/components/editor/AtomicEditor.tsx`) forwards
`documentId` to `AtomicCodeMirrorEditor` and uses `markdownSource` only at
mount time, so swapping documents means changing `documentId`:

```tsx
<AtomicEditor
  documentId={`${activeEntry.key}:${activeEntry.editorSessionId}`}
  value={activeEntry.form.description}
  initialRevealText={activeEntry.revealText}
  autofocus={activeEntry.autofocus}
  onUpdate={(description) => patchEntry(activeEntry.key, { description })}
/>
```

Switching entries changes `documentId`, which remounts the view seeded from
that entry's **in-memory** draft, unsaved text included. `editorSessionId`
remains the escape hatch for forcing a reset within the same entry, which is
what `bumpDescriptionEditorSessionId` does today.

**Known trade-off.** A remount discards CodeMirror's cursor position,
selection, scroll offset, and undo history for the note being left. The text is
safe; the editing context is not. That is acceptable for a first version. Two
follow-ups if it proves annoying: capture a per-entry cursor offset through
`editorHandleRef` on deactivate and restore it on activate, or cache a CM6
`EditorState` per entry, which would need a new prop on the fork in
`lib/atomic-editor`.

`revealText` must become per-entry and be cleared once it fires, otherwise
returning to a note that was opened from a search result re-triggers the
scroll-and-highlight every time.

## 6. UI

Per the request there is **no tab bar**. Two icon buttons join the `NotesHeader`
left cluster beside `jot.new` and `SaveStatusIndicator`.

### Back

`ArrowLeft` from `@phosphor-icons/react`, already a dependency. Disabled when
`backStack` has no surviving target. The `title` names the destination so the
button is not a mystery: `Back to "Quarterly planning notes"`.

### Recent

`ClockCounterClockwise`, opening a Gravity `Popup` — the same pattern as the
existing user menu in `NotesHeader` and the note action menus in
`ResultsColumn`:

```tsx
<Popup anchorRef={recentBtnRef} open={recentOpen} onClose={close} placement="bottom-start" offset={6}>
```

Contents: `openNotes` in MRU order, at most 10 rows, each showing

- **a derived title.** Do not write a third title helper — there are already
  two. `noteHeadline` is private to `NoteResultsList.tsx` (first line,
  punctuation stripped, truncated to 100 characters, `Untitled` fallback) and
  `firstLineLabel` lives in `src/lib/strings.ts` (strips whitespace too, used
  only for aria-labels in `ResultsColumn`). Promote `noteHeadline` into
  `src/lib/strings.ts`, have `NoteResultsList` import it from there, and reuse
  it here. It takes a `NoteRecord` today and needs to accept a raw description
  string instead, because a `draft:` entry has no record;
- the category label as secondary text;
- a per-entry save state dot reusing the `SAVE_STATUS_LABELS` vocabulary from
  `NotesHeader.tsx`;
- the active row marked with `aria-current` and not clickable-to-nothing.

No filter input: ten rows never need one, so a plain `Popup` is right and
`FilterablePickerPopup` would be over-built. Keyboard behavior: arrow keys
move, `Enter` activates, `Escape` closes and returns focus to the trigger.

Selecting a row calls `activateEntry(key)`, which promotes it to the top of the
MRU list, as requested.

### Save status

`SaveStatusIndicator` keeps showing the **active** entry's status. Background
work needs to be visible too, otherwise a failed background save is invisible:
the recent button gets a small badge when any non-active entry is `saving` or
`error`. A background entry sitting at `unsaved` is normal and transient, so it
does not badge.

### Sidebar

Recommendation: mark **open** notes in `ResultsColumn` with a subtle treatment
distinct from the **active** highlight (for example a left rule versus the
existing filled row). Without it the ring is invisible from the place users
actually pick notes, and "why is this note already showing my unsaved text"
becomes surprising. This is a small CSS-module addition plus passing the set of
open note ids alongside the existing `activeNoteId`.

### Mobile

Both buttons are icon-only and sit in the existing header row, which already
collapses the search field on narrow screens. The recent popup should be
width-capped and scrollable. Check it against the 720px breakpoint
(`MOBILE_RESULTS_MEDIA_QUERY`) during implementation.

## 7. URL and history

Keep `?id=` mirroring the **active** entry through `replaceState`, unchanged.

Do **not** put ten open ids in the URL. It is ugly, it is shareable state that
should not be shared, and it re-encodes on every switch.

Deliberately deferred: wiring note switches to `history.pushState` so the
browser and Android back gestures drive `goBack`. It is attractive — one
history model, free hardware-back support on the PWA — but it changes global
navigation behavior, since every note switch would become a history entry and
leaving the app would take N back presses, and it couples the feature to
`popstate` ordering. The in-store `backStack` is deterministic and
unit-testable; ship that first and evaluate history integration separately.

## 8. Code paths that assume a single open note

This is the bulk of the diff surface in `NotesApp.tsx`.

| Location | Required change |
| --- | --- |
| `handleStartEdit` / `handleOpenNoteFromResults` | Drop the awaited flush; call `openExistingNote` then `activateEntry`. |
| `handleCancelEdit`, `handleAddNoteForCategory`, `handleAddNoteForTag` | Open a **new draft entry** instead of resetting the one global form. This changes behavior — see the risk in §11. |
| `handleDeleteNote` | `closeEntry` for that note whether or not it is active, rather than only calling `resetNoteForm` when it happens to be the open one, and purge it from `backStack`. |
| `handleMoveNoteCategory` / `handleMoveNoteTag` | These currently patch `noteForm` when `editingNoteId === note.id`; they must patch the entry for that note if it is open, active or not. |
| `refreshResults` category remap | Fan out across all entries, and relocate off the save path (§4.1). |
| `performDeleteCategory*`, `performDeleteTag`, `handleSaveCategory`, `handleSaveTag` | Remap or clear affected `selectedCategoryId`, `selectedTagIds`, and `categoryInputValue` across all entries. |
| `handleLogout`, `resetDefaultState`, the `restoreSession` error path | Clear `openNotes`, `activeKey`, `backStack`, and `detachedSaves`. |
| `applyNotesUrlSelection` | Seed the first entry rather than assigning the global form, and never clobber an existing entry's unsaved draft when the URL points at an already-open note. |
| `popstate` handler | No flush needed; activate the entry named by the URL. |
| `pagehide` / `visibilitychange` keepalive | Iterate all dirty entries plus `detachedSaves`, not just the one form. |
| `ResultsColumn` `activeNoteId` / `activeCategoryId` / `activeTagIds` | Read from the active entry; add the open-note set (§6). |
| `NoteForm` props | `form`, `setForm`, `editingNoteId`, `descriptionEditorSessionId`, `categoryInputValue`, and `pendingTagLabels` all become active-entry-derived. |
| `useNotesAppStore()` bulk destructures — `NotesApp.tsx:396` and `ResultsColumn.tsx:132` | Both subscribe to the entire store, so any `openNotes` mutation would re-render the whole app including the editor. Convert to selector subscriptions. This is a requirement, not a nicety. |

### Stale-copy reconciliation

Reactivating an entry that has been open a while raises a question the
single-note model never had: the server copy may have moved on, edited in
another browser tab or by the Android client. Rule: on activate, if the entry
is **clean** (live signature equals `savedSignature`) and the `NoteRecord` in
`notes` is newer, refresh the entry's form from the record and bump
`editorSessionId`. If the entry is **dirty**, leave the local draft untouched —
the user's unsaved text always wins, and last-write-wins on save matches
today's behavior.

## 9. Phasing

Each phase should be independently reviewable and leave the app working.

1. **Slice extraction, cap of 1.** Introduce `openNotes.ts` and the store
   slice; migrate `NotesApp`, `NoteForm`, and `NotesHeader` to read through the
   active entry; keep the cap at one entry. No behavior change. This is the
   risky mechanical refactor, isolated. Full test suite plus a manual pass.
2. **Keyed save engine.** Map-based in-flight tracking, per-entry status
   write-back, `detached` mode. Still one entry, so still no behavior change.
3. **Save latency.** Client-side in-place merge (§4.1) and the server-side
   re-embed skip (§4.2). Measurable on its own: a note switch should already
   feel dramatically faster before multi-note lands. Worth shipping as its own
   PR since it benefits the app even if the rest slips.
4. **Multi-entry.** Raise the cap to 10, add eviction and detached saves,
   non-blocking switching, and the back stack. Behavior changes here.
5. **UI.** Back and recent buttons, per-entry status, the promoted
   `noteHeadline`, and the sidebar open-note treatment.
6. **Optional follow-ups.** Persist entries to `localStorage` through
   `notesCache` (bump `schemaVersion` 1 → 2 and add an `openNotes` field so a
   reload restores drafts); per-entry cursor restore; `pushState` history
   integration.

## 10. Testing

`apps/notes-next` runs `node --import tsx --test ./test/*.test.ts` with **no
DOM or React testing setup**, and none should be added for this. That
constraint is exactly why the ring logic goes in a pure module.

New unit tests:

- `test/open-notes.test.ts` — `openExistingNote`, `openNewDraft`, `activate`,
  `goBack`, `closeEntry`, `evictIfNeeded`, `patchEntry`. Cases worth naming:
  opening an already-open note preserves its draft and promotes it; the 11th
  distinct note evicts the LRU and returns it as dropped; eviction never drops
  the active entry; the cap holds even when the LRU is the back target;
  `goBack` walks A→B→C→B→A rather than toggling; `goBack` skips evicted keys;
  deleting a note closes its entry and purges it from the stack; a `draft:`
  entry keeps its key across the `noteId: null` → real id transition and its
  signature is recomputed with the new id.
- `test/note-headline.test.ts` — the promoted `noteHeadline`: heading markers,
  punctuation, empty and whitespace-only documents, the truncation boundary.
- Save-engine reducer tests for whatever can be extracted pure — signature
  comparison, queued-autosave bookkeeping, mode precedence.
- In `lib/db-notes`, extend the DB-backed suite to cover both branches of the
  re-embed skip: a category-only PATCH leaves `embedding_updated_at` untouched,
  and a description change refreshes it.

Manual verification, since these are races unit tests will not catch:

- Type in note A, switch to B before A's save lands, switch back to A. A shows
  the typed text and reads `saved`, with no lost keystrokes.
- Open 11 distinct notes with the first still dirty. The dirty one's save
  completes even though it left the dropdown — verify in the network panel and
  by reloading.
- Kill the tab with three dirty entries. All three persist through keepalive.
- Delete the active note with others open. Focus moves to a sensible entry and
  no orphan is left in the dropdown.
- Sign out with several dirty entries. All flush before the session tears down.
- Rename and delete a category while notes in that category are open in the
  ring. Every affected entry updates.

## 11. Risks

- **Phase 1 is the real risk.** `NotesApp.tsx` is roughly 2,500 lines and the
  save lifecycle is subtle: the synchronous pre-`await` snapshot, the
  `lastSavedNoteDraftRef` dedupe, the `editingNoteIdRef` write-back, and the
  keepalive path all interlock. The existing correctness comments in that file
  are load-bearing documentation — read them before moving anything and carry
  them across.
- **Silent data loss is the failure mode to fear.** Every eviction and every
  non-awaited switch is a place a draft can be dropped. The `detachedSaves` map
  and the widened keepalive exist specifically for this, and the manual checks
  above are not optional.
- **`jot.new` and `+` change meaning.** They currently *replace* the open note;
  afterwards they *add* a draft alongside it. That is the point of the feature,
  but it is a visible change and it makes it easy to accumulate abandoned empty
  drafts. Mitigation: when a draft entry is deactivated while still empty — no
  description, no tags, no dates, which is the existing `newNoteHasUserInput`
  predicate in `NoteForm` — close it instead of keeping it in the ring.
- **Autosave storms.** Ten entries on a 3-second debounce could in principle
  fire ten concurrent requests. In practice only the active entry receives
  edits, and Phase 3 cuts per-save cost from four round-trips plus an embedding
  call down to one round-trip. Worth watching during Phase 4 regardless.
- **Re-render cost.** The two bulk `useNotesAppStore()` destructures mean every
  `openNotes` write would re-render the entire notes app, editor included.
  Selector subscriptions are mandatory.

## 12. Open questions for the product owner

1. **Should the ring survive a reload?** Persisting entries, unsaved drafts
   included, to `localStorage` is listed as an optional Phase 6 item. It is the
   difference between "10 recent notes this session" and "10 recent notes,
   period."
2. **Is 10 the right cap, and should it be a user preference?** The existing
   `user_v1.preferences` JSON already carries `notesApp.*` settings, so making
   it configurable later is cheap.
3. **Explicit close?** This plan has no close button — entries leave only by
   LRU eviction, deletion, or being an abandoned empty draft. A per-row close
   in the recent dropdown is easy to add if wanted.
