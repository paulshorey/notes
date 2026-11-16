import { createEmptyItemDraft, itemDraftFromItem, type ItemDraft } from "@/capabilities/draftParts"

/** The Notes form edits the whole item draft; each part comes from `capabilities/`. */
export type TextCaptureFormState = ItemDraft

export type EmbeddingMaintenanceMode = "missing" | "stale"

/**
 * Lifecycle of the note editor's persistence, surfaced to the UI (e.g. the
 * header save indicator).
 *
 * - `idle`    — empty new draft with nothing worth saving.
 * - `unsaved` — the draft has changes that have not been persisted yet.
 * - `saving`  — a save request for the current note is in flight.
 * - `saved`   — the current note matches what is stored on the server.
 * - `error`   — the last save attempt for the current note failed.
 */
export type ItemSaveStatus = "idle" | "unsaved" | "saving" | "saved" | "error"

export { createDefaultDueValue, createDefaultRemindValue } from "@/capabilities/schedule/draft"

export const createDefaultTextCaptureForm = createEmptyItemDraft

export const itemToFormState = itemDraftFromItem
