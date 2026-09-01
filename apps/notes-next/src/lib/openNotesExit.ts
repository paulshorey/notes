import type { NoteFormState } from "@/types/notes"
import type { OpenNoteEntry, OpenNoteKey, OpenNotesState } from "@/stores/openNotes"

/**
 * The slice of a detached save that persistence and the exit flush need.
 * Keep this free of React so the merge and keepalive rules can be unit-tested.
 */
export interface DetachedSaveSnapshot {
  noteId: number | null
  form: NoteFormState
  savedSignature: string | null
}

export interface ExitFlushItem {
  key: OpenNoteKey
  noteId: number | null
  form: NoteFormState
}

/**
 * Fold detached dirty notes back into ring state for a localStorage write.
 *
 * Eviction removes them from `openNotes`, so a snapshot of the ring alone
 * would drop the very text the exit path claims to recover. Entries already
 * in the ring win — they are the live draft.
 */
export const stateWithDetachedSaves = (
  state: OpenNotesState,
  detached: Iterable<[OpenNoteKey, DetachedSaveSnapshot]>,
  now = Date.now(),
): OpenNotesState => {
  const existing = new Set(state.openNotes.map((entry) => entry.key))
  const extras: OpenNoteEntry[] = []

  for (const [key, save] of detached) {
    if (existing.has(key)) continue
    extras.push({
      key,
      noteId: save.noteId,
      baseTimeModified: null,
      form: save.form,
      savedSignature: save.savedSignature,
      saveStatus: "idle",
      editorSessionId: 0,
      categoryInputValue: "",
      pendingTagLabels: [],
      revealText: null,
      autofocus: false,
      openedAt: now,
      lastActivatedAt: now,
    })
  }

  if (extras.length === 0) return state
  return { ...state, openNotes: [...state.openNotes, ...extras] }
}

export const collectExitFlushItems = (
  openNotes: OpenNoteEntry[],
  detached: Iterable<[OpenNoteKey, DetachedSaveSnapshot]>,
  isDirty: (entry: OpenNoteEntry) => boolean,
  isSaveable: (form: NoteFormState) => boolean,
): ExitFlushItem[] => {
  const seen = new Set<OpenNoteKey>()
  const items: ExitFlushItem[] = []

  for (const entry of openNotes) {
    if (!isSaveable(entry.form) || !isDirty(entry)) continue
    seen.add(entry.key)
    items.push({ key: entry.key, noteId: entry.noteId, form: entry.form })
  }

  for (const [key, save] of detached) {
    if (seen.has(key) || !isSaveable(save.form)) continue
    items.push({ key, noteId: save.noteId, form: save.form })
  }

  return items
}

/**
 * Keepalive requests the dying page can fire. Never-saved drafts (`noteId`
 * null) are excluded: a POST that the page cannot wait for races a reload,
 * which would POST again from the dirty snapshot and create a duplicate note.
 * Those drafts recover from localStorage on the next visit.
 */
export const selectKeepaliveExitItems = (
  items: ExitFlushItem[],
  alreadySent: ReadonlySet<OpenNoteKey>,
): ExitFlushItem[] =>
  items.filter((item) => item.noteId !== null && !alreadySent.has(item.key))
