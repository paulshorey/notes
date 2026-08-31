import type { NoteRecord } from "@lib/db-notes"
import {
  createDefaultNoteForm,
  noteToFormState,
  type NoteFormState,
  type NoteSaveStatus,
} from "@/types/notes"

/**
 * Stable identity for an open entry: `note:${id}` once persisted, `draft:${n}`
 * before that. Identity is deliberately not the note id, because a new note's
 * id changes from null to a real value on its first save and the editor is
 * keyed on this — remounting CodeMirror mid-typing would lose the cursor.
 */
export type OpenNoteKey = string

/**
 * Where an entry is stored. An alias rather than a bare `number` so the shape
 * of an address is stated in one place.
 */
export type NoteRef = number

export interface OpenNoteEntry {
  key: OpenNoteKey
  /** null while this entry is a new note that has never been persisted. */
  noteId: NoteRef | null
  /**
   * `timeModified` of the record this entry was last loaded or saved from.
   * Nothing reads it yet; it is the base revision a conflict check would need,
   * and it is far cheaper to record now than to backfill later.
   */
  baseTimeModified: string | null
  /** Live in-memory draft. */
  form: NoteFormState
  /** Signature of what was last successfully persisted, for the dirty check. */
  savedSignature: string | null
  saveStatus: NoteSaveStatus
  /** Bumped to force the editor to remount within the same entry. */
  editorSessionId: number
  categoryInputValue: string
  pendingTagLabels: string[]
  /** Search term to scroll to and highlight; cleared once it has fired. */
  revealText: string | null
  autofocus: boolean
  openedAt: number
  lastActivatedAt: number
}

export interface OpenNotesState {
  /** MRU-ordered; index 0 is the most recently activated entry. */
  openNotes: OpenNoteEntry[]
  activeKey: OpenNoteKey | null
  /** Visit history, most recent last. Bounded to `cap * 2`. */
  backStack: OpenNoteKey[]
  nextDraftSequence: number
}

export interface OpenNotesResult {
  state: OpenNotesState
  removed: OpenNoteEntry[]
}

export const MAX_OPEN_NOTES_DEFAULT = 10
export const MAX_OPEN_NOTES_MIN = 1
export const MAX_OPEN_NOTES_MAX = 25

export const clampMaxOpenNotes = (value: number): number => {
  if (!Number.isFinite(value)) return MAX_OPEN_NOTES_DEFAULT
  return Math.round(Math.min(Math.max(value, MAX_OPEN_NOTES_MIN), MAX_OPEN_NOTES_MAX))
}

export const noteEntryKey = (noteId: NoteRef): OpenNoteKey => `note:${noteId}`

export const createEmptyOpenNotesState = (): OpenNotesState => ({
  openNotes: [],
  activeKey: null,
  backStack: [],
  nextDraftSequence: 0,
})

export const findEntry = (
  state: OpenNotesState,
  key: OpenNoteKey | null,
): OpenNoteEntry | null =>
  key === null ? null : (state.openNotes.find((entry) => entry.key === key) ?? null)

export const findEntryByNoteId = (
  state: OpenNotesState,
  noteId: NoteRef,
): OpenNoteEntry | null =>
  state.openNotes.find((entry) => entry.noteId === noteId) ?? null

export const getActiveEntry = (state: OpenNotesState): OpenNoteEntry | null =>
  findEntry(state, state.activeKey)

/**
 * The entry `goBack` would activate, or null when the stack has no survivors.
 * Used to label and disable the back button.
 */
export const getBackTarget = (state: OpenNotesState): OpenNoteEntry | null => {
  for (let index = state.backStack.length - 1; index >= 0; index -= 1) {
    const entry = findEntry(state, state.backStack[index] ?? null)
    if (entry && entry.key !== state.activeKey) return entry
  }
  return null
}

export const isEntryDirty = (
  entry: OpenNoteEntry,
  signature: (entry: OpenNoteEntry) => string,
): boolean => signature(entry) !== entry.savedSignature

/**
 * Mirrors `newNoteHasUserInput` in `NoteForm`, inverted: an entry the user has
 * not put anything into. Used to skip creating redundant drafts and to discard
 * abandoned ones.
 */
export const isEmptyDraft = (entry: OpenNoteEntry): boolean =>
  entry.noteId === null &&
  entry.form.description.trim() === "" &&
  entry.form.selectedTagIds.length === 0 &&
  entry.pendingTagLabels.length === 0 &&
  !entry.form.dueExpanded &&
  entry.form.timeDue === null &&
  !entry.form.remindExpanded &&
  entry.form.timeRemind === null

const createEntry = (
  key: OpenNoteKey,
  values: Partial<OpenNoteEntry> & { form: NoteFormState },
): OpenNoteEntry => {
  const now = Date.now()
  return {
    key,
    noteId: null,
    baseTimeModified: null,
    savedSignature: null,
    saveStatus: "idle",
    editorSessionId: 0,
    categoryInputValue: "",
    pendingTagLabels: [],
    revealText: null,
    autofocus: true,
    openedAt: now,
    lastActivatedAt: now,
    ...values,
  }
}

const boundBackStack = (backStack: OpenNoteKey[], cap: number): OpenNoteKey[] => {
  const limit = Math.max(cap, MAX_OPEN_NOTES_MIN) * 2
  return backStack.length <= limit ? backStack : backStack.slice(backStack.length - limit)
}

/**
 * Promote `key` to index 0, record the outgoing entry on the back stack, and
 * make it active. Does not evict: callers that add an entry must activate
 * before evicting, since eviction protects whichever entry is active.
 */
export const activate = (
  state: OpenNotesState,
  key: OpenNoteKey,
  cap: number = MAX_OPEN_NOTES_DEFAULT,
): OpenNotesState => {
  const entry = findEntry(state, key)
  if (!entry) return state
  if (state.activeKey === key) return state

  // An untouched draft the user is walking away from is noise: it would sit in
  // the recent list forever and push real notes out of the ring. Nothing is
  // lost, since by definition it has no content.
  const outgoing = getActiveEntry(state)
  const discardOutgoing = outgoing !== null && isEmptyDraft(outgoing)

  const backStack =
    state.activeKey === null || discardOutgoing
      ? state.backStack
      : [...state.backStack, state.activeKey]

  const survivors = state.openNotes.filter(
    (item) => item.key !== key && (!discardOutgoing || item.key !== outgoing.key),
  )

  // Invariant: the back stack holds where you have *been*, so it never
  // contains the entry you are on now.
  const prunedBackStack = backStack.filter(
    (item) => item !== key && (!discardOutgoing || item !== outgoing.key),
  )

  return {
    ...state,
    openNotes: [{ ...entry, lastActivatedAt: Date.now() }, ...survivors],
    activeKey: key,
    backStack: boundBackStack(prunedBackStack, cap),
  }
}

/**
 * Drop least-recently-used entries until the cap is met. Only the active entry
 * is protected — protecting the back target too can make the cap unenforceable
 * when the back target is the only candidate, and `goBack` already skips keys
 * that no longer exist.
 */
export const evictToCap = (state: OpenNotesState, cap: number): OpenNotesResult => {
  const limit = Math.max(cap, MAX_OPEN_NOTES_MIN)
  if (state.openNotes.length <= limit) return { state, removed: [] }

  const kept = [...state.openNotes]
  const removed: OpenNoteEntry[] = []

  for (let index = kept.length - 1; index >= 0 && kept.length > limit; index -= 1) {
    const candidate = kept[index]
    if (!candidate || candidate.key === state.activeKey) continue
    kept.splice(index, 1)
    removed.push(candidate)
  }

  if (removed.length === 0) return { state, removed: [] }

  const removedKeys = new Set(removed.map((entry) => entry.key))
  return {
    state: {
      ...state,
      openNotes: kept,
      backStack: state.backStack.filter((key) => !removedKeys.has(key)),
    },
    removed,
  }
}

const insertActivateEvict = (
  state: OpenNotesState,
  entry: OpenNoteEntry,
  cap: number,
): OpenNotesResult => {
  const withEntry: OpenNotesState = {
    ...state,
    openNotes: [entry, ...state.openNotes],
  }
  // Order matters: activating first makes the incoming entry the protected one,
  // so the outgoing entry becomes the eviction candidate. Evicting first would
  // protect the outgoing entry and, at cap 1, leave nothing droppable.
  return evictToCap(activate(withEntry, entry.key, cap), cap)
}

export const openExistingNote = (
  state: OpenNotesState,
  note: NoteRecord,
  cap: number = MAX_OPEN_NOTES_DEFAULT,
): OpenNotesResult => {
  const existing = findEntryByNoteId(state, note.id)
  if (existing) {
    // Keep the in-memory draft; the entry is the source of truth while open.
    return { state: activate(state, existing.key, cap), removed: [] }
  }

  const form = noteToFormState(note)
  const entry = createEntry(noteEntryKey(note.id), {
    noteId: note.id,
    baseTimeModified: note.timeModified,
    form,
    categoryInputValue: note.category.label,
  })

  return insertActivateEvict(state, entry, cap)
}

export const openNewDraft = (
  state: OpenNotesState,
  options: {
    categoryId?: number | null
    tagIds?: number[]
    categoryLabel?: string
  } = {},
  cap: number = MAX_OPEN_NOTES_DEFAULT,
): OpenNotesResult => {
  const active = getActiveEntry(state)

  // Reusing an untouched draft keeps repeated `+` presses from pushing real
  // notes out of the ring.
  if (active && isEmptyDraft(active)) {
    const reused: OpenNoteEntry = {
      ...active,
      form: {
        ...active.form,
        selectedCategoryId: options.categoryId ?? active.form.selectedCategoryId,
        selectedTagIds: options.tagIds ?? active.form.selectedTagIds,
      },
      categoryInputValue: options.categoryLabel ?? active.categoryInputValue,
      autofocus: true,
      editorSessionId: active.editorSessionId + 1,
    }
    return {
      state: {
        ...state,
        openNotes: state.openNotes.map((entry) => (entry.key === active.key ? reused : entry)),
      },
      removed: [],
    }
  }

  const entry = createEntry(`draft:${state.nextDraftSequence}`, {
    form: {
      ...createDefaultNoteForm(),
      selectedCategoryId: options.categoryId ?? null,
      selectedTagIds: options.tagIds ?? [],
    },
    categoryInputValue: options.categoryLabel ?? "",
  })

  return insertActivateEvict({ ...state, nextDraftSequence: state.nextDraftSequence + 1 }, entry, cap)
}

/**
 * Walk backwards through visit history rather than toggling between the two
 * most recent entries. Popping without pushing is what keeps the walk
 * monotonic: A → B → C, back, back lands on A rather than returning to C.
 */
export const goBack = (state: OpenNotesState): OpenNotesState => {
  const backStack = [...state.backStack]

  while (backStack.length > 0) {
    const key = backStack.pop()
    if (key === undefined || key === state.activeKey) continue

    const entry = findEntry(state, key)
    if (!entry) continue

    return {
      ...state,
      openNotes: [
        { ...entry, lastActivatedAt: Date.now() },
        ...state.openNotes.filter((item) => item.key !== key),
      ],
      activeKey: key,
      backStack,
    }
  }

  return backStack.length === state.backStack.length ? state : { ...state, backStack }
}

export const closeEntry = (
  state: OpenNotesState,
  key: OpenNoteKey,
  cap: number = MAX_OPEN_NOTES_DEFAULT,
): OpenNotesResult => {
  const entry = findEntry(state, key)
  if (!entry) return { state, removed: [] }

  const withoutEntry: OpenNotesState = {
    ...state,
    openNotes: state.openNotes.filter((item) => item.key !== key),
    backStack: state.backStack.filter((item) => item !== key),
  }

  if (state.activeKey !== key) {
    return { state: withoutEntry, removed: [entry] }
  }

  const orphaned: OpenNotesState = { ...withoutEntry, activeKey: null }
  const backTarget = getBackTarget(orphaned)
  const nextKey = backTarget?.key ?? orphaned.openNotes[0]?.key ?? null

  if (nextKey === null) {
    const { state: withDraft } = openNewDraft(orphaned, {}, cap)
    return { state: withDraft, removed: [entry] }
  }

  return {
    state: {
      ...orphaned,
      activeKey: nextKey,
      openNotes: [
        ...orphaned.openNotes.filter((item) => item.key === nextKey),
        ...orphaned.openNotes.filter((item) => item.key !== nextKey),
      ],
      backStack: orphaned.backStack.filter((item) => item !== nextKey),
    },
    removed: [entry],
  }
}

export const patchEntry = (
  state: OpenNotesState,
  key: OpenNoteKey,
  patch: Partial<OpenNoteEntry> | ((entry: OpenNoteEntry) => Partial<OpenNoteEntry>),
): OpenNotesState => {
  const index = state.openNotes.findIndex((entry) => entry.key === key)
  if (index === -1) return state

  const current = state.openNotes[index]
  if (!current) return state

  const resolved = typeof patch === "function" ? patch(current) : patch
  const next = { ...current, ...resolved }

  const openNotes = [...state.openNotes]
  openNotes[index] = next
  return { ...state, openNotes }
}

export const patchEntryForm = (
  state: OpenNotesState,
  key: OpenNoteKey,
  form: NoteFormState | ((current: NoteFormState) => NoteFormState),
): OpenNotesState =>
  patchEntry(state, key, (entry) => ({
    form: typeof form === "function" ? form(entry.form) : form,
  }))

/**
 * Drop every entry pointing at a note that no longer exists. Used after a
 * delete so a closed note cannot linger in the recent list.
 */
export const closeEntriesForNote = (
  state: OpenNotesState,
  noteId: NoteRef,
  cap: number = MAX_OPEN_NOTES_DEFAULT,
): OpenNotesResult => {
  const entry = findEntryByNoteId(state, noteId)
  if (!entry) return { state, removed: [] }
  return closeEntry(state, entry.key, cap)
}
