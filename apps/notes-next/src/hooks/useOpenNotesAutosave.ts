"use client"

import { useEffect, useRef } from "react"
import { isSaveableForm, serializeNoteDraft } from "@/lib/noteDraft"
import type { OpenNoteEntry, OpenNoteKey } from "@/stores/openNotes"

export const NOTE_AUTOSAVE_DEBOUNCE_MS = 3000

interface ArmedTimer {
  timeoutId: number
  /** Signature the timer was armed for, so unrelated renders do not reset it. */
  signature: string
}

/**
 * One trailing debounce per dirty entry.
 *
 * A timer is only re-armed when *that entry's* signature changes. Re-arming
 * everything whenever the entry list changes would mean a background note could
 * never save while the user keeps typing in the active one, since every
 * keystroke would push its deadline back.
 */
export function useOpenNotesAutosave({
  entries,
  enabled,
  saveEntry,
}: {
  entries: OpenNoteEntry[]
  enabled: boolean
  saveEntry: (key: OpenNoteKey, mode: "autosave") => void | Promise<void>
}) {
  const timersRef = useRef(new Map<OpenNoteKey, ArmedTimer>())
  const saveEntryRef = useRef(saveEntry)
  saveEntryRef.current = saveEntry

  useEffect(() => {
    const timers = timersRef.current

    const clearTimer = (key: OpenNoteKey) => {
      const armed = timers.get(key)
      if (armed === undefined) return
      window.clearTimeout(armed.timeoutId)
      timers.delete(key)
    }

    if (!enabled) {
      for (const key of [...timers.keys()]) clearTimer(key)
      return
    }

    const dirtyKeys = new Set<OpenNoteKey>()

    for (const entry of entries) {
      if (!isSaveableForm(entry.form)) continue

      const signature = serializeNoteDraft(entry.noteId, entry.form)
      if (signature === entry.savedSignature) continue

      dirtyKeys.add(entry.key)

      const armed = timers.get(entry.key)
      if (armed && armed.signature === signature) continue

      if (armed) window.clearTimeout(armed.timeoutId)

      const key = entry.key
      timers.set(key, {
        signature,
        timeoutId: window.setTimeout(() => {
          timers.delete(key)
          void saveEntryRef.current(key, "autosave")
        }, NOTE_AUTOSAVE_DEBOUNCE_MS),
      })
    }

    for (const key of [...timers.keys()]) {
      if (!dirtyKeys.has(key)) clearTimer(key)
    }
  }, [enabled, entries])

  useEffect(() => {
    const timers = timersRef.current
    return () => {
      for (const armed of timers.values()) window.clearTimeout(armed.timeoutId)
      timers.clear()
    }
  }, [])
}
