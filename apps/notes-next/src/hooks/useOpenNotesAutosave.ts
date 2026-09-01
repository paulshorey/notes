"use client"

import { useEffect, useRef } from "react"
import { isSaveableForm, serializeNoteDraft } from "@/lib/noteDraft"
import type { OpenNoteEntry, OpenNoteKey } from "@/stores/openNotes"

export const NOTE_AUTOSAVE_DEBOUNCE_MS = 3000
const NOTE_AUTOSAVE_MAX_BACKOFF_MS = 60_000

interface ArmedTimer {
  timeoutId: number
  /** Signature the timer was armed for, so unrelated renders do not reset it. */
  signature: string
}

interface FailureState {
  /** The signature that failed, so a fresh edit starts over at full speed. */
  signature: string
  attempts: number
}

/**
 * Back off after a failed save. Without this an outage turns into a retry every
 * three seconds, per dirty note, for as long as it lasts: the failure sets
 * `saveStatus: "error"`, that patch changes the entry list, the effect re-runs,
 * and the still-dirty entry is armed again immediately.
 */
const retryDelay = (attempts: number) =>
  Math.min(NOTE_AUTOSAVE_DEBOUNCE_MS * 2 ** attempts, NOTE_AUTOSAVE_MAX_BACKOFF_MS)

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
  saveEntry: (key: OpenNoteKey, mode: "autosave") => boolean | Promise<boolean>
}) {
  const timersRef = useRef(new Map<OpenNoteKey, ArmedTimer>())
  const failuresRef = useRef(new Map<OpenNoteKey, FailureState>())
  const saveEntryRef = useRef(saveEntry)
  saveEntryRef.current = saveEntry

  useEffect(() => {
    const timers = timersRef.current
    const failures = failuresRef.current

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
      const failure = failures.get(key)
      // Editing after a failure is a fresh attempt, so only back off while the
      // exact text that failed is being retried.
      if (failure && failure.signature !== signature) failures.delete(key)
      const delay =
        failure && failure.signature === signature
          ? retryDelay(failure.attempts)
          : NOTE_AUTOSAVE_DEBOUNCE_MS

      timers.set(key, {
        signature,
        timeoutId: window.setTimeout(() => {
          timers.delete(key)
          void Promise.resolve(saveEntryRef.current(key, "autosave")).then((persisted) => {
            if (persisted) {
              failures.delete(key)
              return
            }
            const previous = failures.get(key)
            failures.set(key, {
              signature,
              attempts: previous?.signature === signature ? previous.attempts + 1 : 1,
            })
          })
        }, delay),
      })
    }

    for (const key of [...timers.keys()]) {
      if (!dirtyKeys.has(key)) clearTimer(key)
    }
    for (const key of [...failures.keys()]) {
      if (!dirtyKeys.has(key)) failures.delete(key)
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
