---
name: Multiple Open Notes — concurrent in-memory editors
overview: Replace the single-note editor model in `apps/notes-next` with a bounded ring of up to 10 open notes held in memory at once. Switching notes becomes instant (no awaited save), each open note keeps its own live draft and save status, and the header gains a "back" button plus a "recent" dropdown instead of a tab bar. Includes the save-latency work that makes concurrent editing viable.
todos:
  - id: openNotes_slice
    content: Extract per-note editor state (form, saved signature, save status, editor session id, category input, pending tag labels) out of the flat notesAppStore fields into an `openNotes` entry list plus `activeKey`, backed by pure helpers in a separate module so the logic is unit-testable without a DOM
    status: pending
  - id: keyed_save_engine
    content: Rework saveCurrentNote into a per-entry save engine — in-flight promises keyed by entry, concurrent saves across different notes, serialized saves per note, per-entry status write-back by key rather than by "is this still the active note"
    status: pending
  - id: non_blocking_switch
    content: Stop awaiting flushPendingNoteSave() when switching notes. Switching fires a background save for the outgoing entry and activates the target entry immediately; the outgoing draft stays in memory so nothing depends on the request finishing
    status: pending
  - id: ring_and_eviction
    content: Cap the ring at 10 entries with LRU eviction. Evicting a dirty entry hands its snapshot to a detached-save map so the request still completes (and is still covered by the pagehide keepalive) after the entry leaves the UI
    status: pending
  - id: back_stack
    content: Add a bounded visit-history stack so "back" walks backwards through visited notes instead of ping-ponging between the two most recent, and prune keys from it as entries are evicted or deleted
    status: pending
  - id: header_ui
    content: Add "back" and "recent" buttons to NotesHeader — back is disabled with an empty stack, recent opens a Gravity Popup listing the open entries MRU-first with derived titles (reusing the promoted noteHeadline helper), category, and per-entry save state; selecting one activates and promotes it
    status: pending
  - id: save_latency
    content: Stop calling refreshResults() (three full list fetches) after every note save; merge the returned NoteRecord in place and coalesce list refreshes. This is what makes N concurrent autosaves affordable
    status: pending
  - id: lifecycle_fanout
    content: Update every code path that assumes one open note — note delete, category/tag delete and rename, logout/reset, URL sync, popstate, pagehide keepalive, and the post-save category fallback remap
    status: pending
  - id: tests
    content: Unit tests for the pure ring/back-stack/eviction helpers and the save-engine reducers via the existing node test runner; manual verification of the switch-while-saving and eviction-while-dirty races
    status: pending
  - id: docs
    content: Update apps/notes-next/AGENTS.md — rewrite the "Note saving lifecycle" section for the multi-entry model, document the ring/back/recent behavior, and drop the stale FilterBanners.tsx reference
    status: pending
isProject: true
---

# Multiple Open Notes — concurrent in-memory editors

## Status: proposed (not started)

Planning only. No implementation has landed. Every file path below refers to
current code unless it says "new".

## 1. The problem, precisely

The app keeps exactly **one** note in editable state. `notesAppStore` holds a
single `noteForm` plus a single `editingNoteId`, and `NotesApp` holds a single
`lastSavedNoteDraftRef` / `noteSavePromiseRef` pair. Because there is only one
slot, opening a second note has to destroy the first one's draft — so the code
must persist it first, and it does so by blocking:

```ts
// apps/notes-next/src/components/notes/NotesApp.tsx
const handleStartEdit = async (note: NoteRecord) => {
  if (editingNoteIdRef.current !== note.id) {
    await flushPendingNoteSave()   // <-- the stall the user feels
  }
  ...
}
```

`flushPendingNoteSave()` awaits `saveCurrentNote("flush")`, which does a
`POST`/`PATCH /api/notes` and then `await refreshResults(currentUser.id)` — and
`refreshResults` refetches **all** notes, **all** categories, and **all** tags.
On the server, every create/update calls `createNoteEmbeddingInput` (a Jina API
round-trip) before it touches Postgres. So a note switch costs one embedding
call plus four HTTP round-trips before the new note appears.

The same `await flushPendingNoteSave()` gate sits in front of
`handleAddNoteForCategory`, `handleAddNoteForTag`, `handleCancelEdit`
(header `jot.new` / `+` / cancel), and the `popstate` handler.

Two independent problems fall out of this, and both need fixing:

- **Structural:** one editor slot, so a switch is destructive and must be
  ordered after a successful save.
- **Latency:** each save is far slower than it needs to be. Even with a
  non-blocking switch, keeping ~10 notes autosaving on a 3-second debounce
  while each save triggers three full list refetches is not acceptable.

## 2. Target model

A bounded, MRU-ordered **ring of open entries**. Each entry owns everything
that is today a single global field.

### 2.1 Entry shape

New module `apps/notes-next/src/stores/openNotes.ts` (pure helpers + types,
no React, no Zustand — so it is directly unit-testable):

```ts
/** Stable identity for an open entry. Survives the note's first save. */
export type OpenNoteKey = string // `note:${id}` for existing notes, `draft:${n}` for new ones

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
  /** Moved `editorRevealText`; must not re-fire when returning to the entry. */
  revealText: string | null
  /** Moved `editorAutofocus`. */
  autofocus: boolean
  openedAt: number
  lastActivatedAt: number
}
```

### 2.2 Store shape

`notesAppStore` gains the fields below. It correspondingly loses seven flat
fields that move into the entry — `noteForm`, `editingNoteId`, `noteSaveStatus`,
`descriptionEditorSessionId`, `pendingTagLabels`, `categoryInputValue`,
`editorAutofocus` — while two more per-note values move in from `NotesApp`'s
local state and refs: `editorRevealText` (a `useState`) and
`lastSavedNoteDraftRef` (a ref, becoming `savedSignature`). Everything else in
the store (`resultsListVisible`, `manuallyExpandedCategoryId`, `selectedTagId`,
`searchQuery`) is app-wide and stays flat.

```ts
openNotes: OpenNoteEntry[]      // MRU-ordered, index 0 = most recently activated
activeKey: OpenNoteKey | null
backStack: OpenNoteKey[]        // visit history, most recent last
nextDraftSequence: number       // for minting `draft:${n}` keys
```

`MAX_OPEN_NOTES = 10`.

Derived selectors (thin, memoized) keep the rest of the app readable:
`selectActiveEntry`, `selectActiveForm`, `selectActiveSaveStatus`,
`selectRecentEntries`, `selectBackTarget`, `selectHasBackgroundActivity`.

### 2.3 Why a key, not the note id

A brand-new note has `noteId === null` until its first save returns an id. If
identity were the note id, the first save would change the entry's identity and
therefore its `documentId`, remounting CodeMirror mid-typing. The `draft:${n}`
key stays stable across that transition and `noteId` is simply filled in — the
same trick the current code performs with `editingNoteIdRef` inside
`saveCurrentNote`, generalized.

### 2.4 Store operations (all pure helpers, all tested)

| Operation                                     | Behavior                                                                                                                                                                                                                      |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `openExistingNote(state, note)`               | If an entry for `note.id` exists: activate + promote to index 0, **keep its in-memory draft** (do not reload from the server record). Otherwise create an entry from `noteToFormState(note)`, insert at 0, evict if over cap. |
| `openNewDraft(state, { categoryId, tagIds })` | Mint `draft:${nextDraftSequence}`, insert at 0, evict if over cap.                                                                                                                                                            |
| `activate(state, key)`                        | Push the outgoing `activeKey` onto `backStack`, set `activeKey`, promote the entry to index 0, bump `lastActivatedAt`.                                                                                                        |
| `goBack(state)`                               | Pop keys off `backStack` until one still exists in `openNotes`; activate it **without** pushing the outgoing key back onto the stack.                                                                                         |
| `closeEntry(state, key)`                      | Remove from `openNotes`, purge from `backStack`. If it was active, activate the back target, else the new index 0, else open a fresh draft.                                                                                   |
| `evictIfNeeded(state)`                        | While `openNotes.length > MAX_OPEN_NOTES`, drop the last entry that is neither active nor the back target. Returns the dropped entries so the caller can hand dirty ones to the detached-save map.                            |
| `patchEntry(state, key, patch)`               | The single write path for form/status/signature updates, used by both the UI and save completions.                                                                                                                            |

**Back semantics — deliberate choice.** "Back" pops a visit-history stack, it
does not mean "activate index 1 of the MRU list". Those differ: with MRU-index-1
semantics, pressing back twice returns you to where you started, because the
first press promotes the target to index 0. A real stack lets back walk A → B →
C → back → B → back → A. Back never pushes onto the stack, which is what makes
the walk monotonic.

## 3. Save engine

### 3.1 Keyed, concurrent, non-blocking

`saveCurrentNote(mode)` becomes `saveEntry(key, mode)`. Changes:

- The synchronous pre-`await` snapshot stays (it is load-bearing), but it
  snapshots **that entry**, not `noteFormRef.current`.
- `noteSavePromiseRef: Promise<void> | null` becomes
  `saveInFlight: Map<OpenNoteKey, Promise<void>>`. Saves for different entries
  run concurrently; a second save for the _same_ entry follows the existing
  rules (an `autosave` marks itself queued, a `flush` awaits then re-checks the
  signature).
- `queuedAutosaveRef: boolean` becomes `Set<OpenNoteKey>`.
- Completion write-back keys off the entry, not "is this still the note the
  editor is showing". The current guard —

  ```ts
  const stillEditingSavedNote =
    editingNoteIdRef.current === noteId || (noteId === null && editingNoteIdRef.current === null)
  ```

  — exists only because state is global; with per-entry state it becomes
  `patchEntry(key, { savedSignature, saveStatus, noteId })` and is correct
  whether or not the user has moved on.

- Modes become `manual | autosave | flush | detached`. `detached` saves an
  entry that has already left the ring (see 3.3) and never touches store state.

### 3.2 Autosave fan-out

The single debounce effect is replaced by one debounce **per dirty entry**. The
cleanest form is a small `useOpenNotesAutosave()` hook (new,
`src/hooks/useOpenNotesAutosave.ts`) holding `Map<OpenNoteKey, timeoutId>`: on
every `openNotes` change, for each entry whose signature differs from
`savedSignature` and which passes the existing "has description and category"
guards, (re)arm a 3s trailing timer; clear timers for entries that became clean
or disappeared.

Only the active entry receives keystrokes, so in practice at most one timer is
ever re-armed repeatedly; background entries fire once and go clean.

### 3.3 Switching, and eviction of a dirty entry

Switching no longer awaits anything:

```ts
const activateEntry = (key: OpenNoteKey) => {
  const outgoing = activeKeyRef.current
  if (outgoing && outgoing !== key) void saveEntry(outgoing, "autosave") // fire, don't await
  store.activate(key)
}
```

The outgoing draft is safe because it is still in `openNotes`. If its request
fails, its entry shows `error` in the Recent dropdown and the autosave hook
retries on the next change.

Eviction is the one place where a draft genuinely leaves memory, so it needs
care. `evictIfNeeded` returns dropped entries; for each dropped entry that is
dirty, `NotesApp` moves `{ noteId, form, signature }` into a
`detachedSaves: Map<OpenNoteKey, DetachedSave>` ref and calls
`saveEntry(key, "detached")`, deleting the map entry on success. Consequences:

- The entry vanishes from the dropdown immediately (no zombie UI state).
- The request still completes, and the `pagehide` / `visibilitychange`
  keepalive handler iterates `detachedSaves` **and** `openNotes`, so an abrupt
  tab close still persists both.
- Never evict the active entry or the current back target — `evictIfNeeded`
  skips them and drops the next candidate.

### 3.4 Awaited flushes that must stay awaited

Non-blocking switching does not mean removing `flush`. These paths still await,
now over **all dirty entries** (`Promise.allSettled`):

- `handleLogin` — must persist before the anonymous merge token is captured.
- `handleSignup` — must persist before the claim flips the row.
- `handleLogout` — must persist before the session is torn down and
  `openNotes` is cleared.

The `popstate` handler no longer needs to flush at all: the target note is
already in memory with its own draft, so applying the URL selection is
non-destructive.

## 4. Save latency

Without this section, ten notes autosaving would be worse than the current
single-note stall, not better.

**Drop `refreshResults` from the save path.** Today every save ends with three
full list fetches. Instead, merge the returned record:

```ts
setNotes((prev) => {
  const without = prev.filter((n) => n.id !== data.note.id)
  return [...without, data.note]
})
```

Two things `refreshResults` was silently providing must be replaced:

- **`CategoryRecord.noteCount` / `TagRecord.noteCount`** come from
  `/api/categories` and `/api/tags`. Derive these client-side from `notes`
  (the sidebar already groups notes by category, so the count is available)
  rather than refetching. If deriving proves fiddly, the fallback is a
  **coalesced** background `refreshResults` — a single trailing timer shared by
  all saves, ~5s — instead of one per save.
- **The category fallback remap** inside `refreshResults`:

  ```ts
  setNoteForm((prev) => prev.selectedCategoryId still exists ? prev : { ...prev, selectedCategoryId: getDefaultCategoryId(latest) })
  ```

  This must now map over **every** entry in `openNotes`, and belongs where
  categories actually change (create / delete / merge), not on the save path.

Not in scope, but worth recording: the biggest single component of save latency
is the synchronous Jina embedding call in `createNoteForNotesApp` /
`updateNoteForNotesApp` (`lib/db-notes/services/notes-app.ts`). Making
embedding asynchronous is a `@lib/db-notes` change with its own migration and
backfill implications — a separate plan, not a prerequisite for this one.

## 5. Editor integration

**One mounted `AtomicEditor`, driven by the active entry.** Ten live CodeMirror
views would be expensive and pointless — only one is visible.

`AtomicCodeMirrorEditor` documents its own contract:

> `markdownSource` — the markdown document to open the editor on. Used only at
> mount time … To swap documents, change `documentId`.

So:

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
that entry's **in-memory** draft — unsaved text included. `editorSessionId`
remains as the escape hatch for forcing a reset within the same entry (what
`bumpDescriptionEditorSessionId` does today).

**Known trade-off:** a remount discards CodeMirror's cursor position, selection,
scroll offset, and undo history for the note being left. The text is safe; the
editing context is not. Acceptable for a first version. Two follow-ups if it
proves annoying: store a per-entry cursor offset captured via
`editorHandleRef` on deactivate and restore it on activate; or cache a
CM6 `EditorState` per entry, which needs a new prop on the fork in
`lib/atomic-editor`.

`revealText` must become per-entry and be cleared after it fires once —
otherwise returning to a note opened from a search result re-triggers the
scroll-and-highlight every time.

## 6. UI

Per the request: **no tab bar.** Two buttons in the `NotesHeader` left cluster,
beside `jot.new` and `SaveStatusIndicator`.

### Back

`ArrowLeft` (Phosphor, already a dependency). Disabled when `backStack` has no
surviving target. `title` names the target note so the button is not a mystery:
`Back to "Quarterly planning notes"`.

### Recent

`ClockCounterClockwise`, opening a Gravity `Popup` — the same pattern as the
existing user menu in `NotesHeader` and the note action menus in
`ResultsColumn`:

```tsx
<Popup anchorRef={recentBtnRef} open={recentOpen} onClose={close} placement="bottom-start" offset={6}>
```

Contents: `openNotes` in MRU order, max 10 rows, each showing

- a derived title. **Do not write a third title helper** — there are already
  two: `noteHeadline` (private to `NoteResultsList.tsx`, first line with
  punctuation stripped, truncated to 100 chars, `Untitled` fallback) and
  `firstLineLabel` (`src/lib/strings.ts`, strips whitespace too, used only for
  aria-labels in `ResultsColumn`). Promote `noteHeadline` into
  `src/lib/strings.ts`, have `NoteResultsList` import it from there, and reuse
  it for the dropdown. It takes a `NoteRecord` today and will need to accept a
  raw description string instead, since a `draft:` entry has no record;
- the category label, secondary text;
- a per-entry save state dot reusing the `SAVE_STATUS_LABELS` vocabulary;
- the active row marked (`aria-current`) and not clickable-to-nothing.

No filter input — ten rows never need one, so a plain `Popup` is right and
`FilterablePickerPopup` would be over-built here. Keyboard: arrow keys move,
`Enter` activates, `Escape` closes, focus returns to the trigger.

Selecting a row calls `activateEntry(key)`, which promotes it to the top of the
MRU list, exactly as requested.

### Save status

`SaveStatusIndicator` keeps showing the **active** entry's status. Background
work needs to be visible too, otherwise a failed background save is invisible:
the Recent button gets a small badge when any non-active entry is `saving` or
`error`. `unsaved` on a background entry is normal and transient, so it does not
badge.

### Mobile

Both buttons are icon-only and sit in the existing header row, which already
collapses the search field on narrow screens. The Recent popup should be
width-capped and scrollable. Worth checking against the 720px breakpoint
(`MOBILE_RESULTS_MEDIA_QUERY`) during implementation.

## 7. URL and history

Keep `?id=` mirroring the **active** entry via `replaceState`, unchanged.

Do **not** put the ten open ids in the URL — it is ugly, it is shareable state
that should not be shared, and it re-encodes on every switch.

Deliberately deferred: wiring note switches to `history.pushState` so the
browser/Android back gesture drives `goBack`. It is attractive (one history
model, free hardware-back support on the PWA) but it changes global navigation
behavior — every note switch becomes a history entry, so leaving the app takes
N back presses — and it couples the feature to `popstate` ordering. The
in-store `backStack` is deterministic and unit-testable; ship that first and
evaluate history integration separately.

## 8. Code paths that assume a single open note

Each of these needs auditing; this is the bulk of the diff surface in
`NotesApp.tsx`.

| Location                                                              | Required change                                                                                                                                                                       |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `handleStartEdit` / `handleOpenNoteFromResults`                       | Drop the awaited flush; call `openExistingNote` + `activateEntry`.                                                                                                                    |
| `handleCancelEdit`, `handleAddNoteForCategory`, `handleAddNoteForTag` | Open a **new draft entry** instead of resetting the one global form. Note this changes behavior: `jot.new` currently replaces the current note; it will now add a draft alongside it. |
| `handleDeleteNote`                                                    | `closeEntry` for that note (not just `resetNoteForm` when it happens to be active), and purge it from `backStack`.                                                                    |
| `refreshResults` category remap                                       | Fan out across all entries (see §4).                                                                                                                                                  |
| `performDeleteCategory*` / `performDeleteTag` / rename handlers       | Remap or clear affected `selectedCategoryId` / `selectedTagIds` / `categoryInputValue` across all entries.                                                                            |
| `handleLogout`, `resetDefaultState`, the `restoreSession` error path  | Clear `openNotes`, `activeKey`, `backStack`, and `detachedSaves`.                                                                                                                     |
| `applyNotesUrlSelection`                                              | Seed the first entry rather than assigning the global form; must not clobber an existing entry's unsaved draft when the URL points at an already-open note.                           |
| `popstate` handler                                                    | No flush needed; activate the entry named by the URL.                                                                                                                                 |
| `pagehide` / `visibilitychange` keepalive                             | Iterate all dirty entries plus `detachedSaves`, not just the one form.                                                                                                                |
| `ResultsColumn` `activeNoteId` / `activeCategoryId` / `activeTagIds`  | Read from the active entry. Consider also marking _open_ notes in the sidebar, distinct from the active one.                                                                          |
| `NoteForm` props                                                      | `form` / `setForm` / `editingNoteId` / `descriptionEditorSessionId` / `categoryInputValue` / `pendingTagLabels` all become active-entry-derived.                                      |
| `useNotesAppStore()` bulk destructure (`NotesApp.tsx` ~line 375)      | This subscribes to the entire store, so any `openNotes` mutation re-renders the whole app. Move the new slice to selector subscriptions.                                              |

### Stale-copy reconciliation

Reactivating an entry that has been open a while raises a question the
single-note model never had: the server copy may have moved on (edited in
another tab, or by the Android client). Rule: on activate, if the entry is
**clean** (`signature === savedSignature`) and the `NoteRecord` in `notes` is
newer, refresh the entry's form from the record and bump `editorSessionId`. If
the entry is **dirty**, keep the local draft untouched — the user's unsaved text
always wins, and last-write-wins on save matches today's behavior.

## 9. Phasing

Each phase should be independently reviewable and leave the app working.

1. **Slice extraction, single entry.** Introduce `openNotes.ts` helpers and the
   store slice, migrate `NotesApp` / `NoteForm` / `NotesHeader` to read through
   the active entry, cap at 1 entry. No behavior change; this is the risky
   mechanical refactor, isolated. Full test suite + manual pass.
2. **Keyed save engine.** Map-based in-flight tracking, per-entry status
   write-back, `detached` mode. Still one entry, so still no behavior change.
3. **Save latency.** In-place `NoteRecord` merge, remove `refreshResults` from
   the save path, relocate the category remap. Measurable on its own: a switch
   should already feel faster before multi-note lands.
4. **Multi-entry.** Raise the cap to 10, add eviction, non-blocking switching,
   back stack. Behavior changes here.
5. **UI.** Back and Recent buttons, per-entry status, promoted `noteHeadline`.
6. **Optional follow-ups.** Persist entries to `localStorage` via `notesCache`
   (schemaVersion 1 → 2, add an `openNotes` field, so a reload restores drafts);
   per-entry cursor restore; `pushState` history integration.

## 10. Testing

`apps/notes-next` runs the node test runner (`node --import tsx --test
./test/*.test.ts`) with **no DOM or React testing setup**, and none should be
added for this. That constraint is exactly why the ring logic goes in a pure
module.

New unit tests:

- `test/open-notes.test.ts` — `openExistingNote` / `openNewDraft` / `activate` /
  `goBack` / `closeEntry` / `evictIfNeeded` / `patchEntry`. Cases worth naming:
  opening an already-open note preserves its draft and promotes it; the 11th
  distinct note evicts the LRU and returns it as dropped; eviction never drops
  the active entry or the back target; `goBack` walks A→B→C→B→A rather than
  toggling; `goBack` skips keys that were evicted; deleting a note closes its
  entry and purges it from the stack; a `draft:` entry keeps its key across the
  transition from `noteId: null` to a real id.
- `test/note-headline.test.ts` — the promoted `noteHeadline`: heading markers,
  punctuation, empty and whitespace-only documents, truncation boundary.
- Save-engine reducer tests for whatever can be extracted pure (signature
  comparison, queued-autosave bookkeeping, mode precedence).

Manual verification, since these are races that unit tests will not catch:

- Type in note A, switch to B before A's save lands, switch back to A → A shows
  the typed text and `saved`, no lost keystrokes.
- Open 11 distinct notes with the 1st still dirty → the dirty one's save
  completes even though it left the dropdown (verify the request in the network
  panel and the persisted text on reload).
- Kill the tab with three dirty entries → all three persist via keepalive.
- Delete the active note with others open → focus moves to a sensible entry,
  no orphan in the dropdown.
- Sign out with several dirty entries → all flush before the session tears down.

## 11. Risks

- **The Phase 1 refactor is the real risk.** `NotesApp.tsx` is ~2500 lines and
  the save lifecycle is subtle: the synchronous pre-`await` snapshot, the
  `lastSavedNoteDraftRef` dedupe, the `editingNoteIdRef` write-back, and the
  keepalive path all interlock. The existing correctness comments in that file
  are load-bearing documentation — read them before moving anything, and carry
  them across.
- **Silent data loss is the failure mode to fear.** Every eviction and every
  non-awaited switch is a place where a draft can be dropped. The
  `detachedSaves` map and the widened keepalive exist specifically for this, and
  the manual checks above are not optional.
- **Behavior change in `jot.new` / `+`.** These currently _replace_ the open
  note; afterwards they _add_ a draft. That is the point of the feature, but it
  is a visible change and it makes it easy to accumulate abandoned empty
  drafts. Mitigation: when a draft entry is deactivated while still empty
  (no description, no tags, no dates — the existing `newNoteHasUserInput`
  predicate in `NoteForm`), close it instead of keeping it in the ring.
- **Autosave storms.** Ten entries with a 3s debounce could in principle fire
  ten concurrent requests. In practice only the active entry receives edits, and
  Phase 3 cuts per-save cost from four round-trips to one. Worth watching
  during Phase 4 anyway.
- **Re-render cost.** The current bulk `useNotesAppStore()` destructure means
  every `openNotes` write re-renders the entire notes app, editor included.
  Selector subscriptions for the new slice are a requirement, not a nicety.

## 12. Open questions for the product owner

1. **Should the sidebar mark open notes?** Right now `activeNoteId` highlights
   exactly one. Distinguishing "open" from "active" would make the ring
   discoverable, but adds visual noise.
2. **Should the ring survive a reload?** Persisting entries (including unsaved
   drafts) to `localStorage` is listed as an optional Phase 6 item. It is the
   difference between "10 recent notes this session" and "10 recent notes,
   period."
3. **Is 10 the right cap, and should it be a user preference?** The existing
   `user_v1.preferences` JSON already carries `notesApp.*` settings, so it would
   be cheap to make configurable later.
4. **Explicit close?** The plan has no close button — entries leave only by LRU
   eviction, deletion, or being an abandoned empty draft. A per-row close in the
   Recent dropdown is easy to add if wanted.
