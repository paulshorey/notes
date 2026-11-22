import type { ItemRecord } from "@lib/db-items"
import { schedulePart, type ScheduleDraft } from "./schedule/draft"
import { statusPart, type StatusDraft } from "./status/draft"
import { filingPart, tagsPart, type FilingDraft, type TagsDraft } from "./taxonomy"
import { textPart, type TextDraft } from "./text/draft"
import type { ItemDraftPart } from "./types"

/** Everything a form holds for one item: its filing, its tags, and each capability. */
export type ItemDraft = FilingDraft & StatusDraft & TagsDraft & TextDraft & ScheduleDraft

/**
 * The parts of a draft, in the order their request fields are written.
 *
 * That order is stored: a saved entry's signature is the request serialized in this
 * order, and browsers keep signatures across reloads. Add a new part at the end, so
 * existing signatures still match and no open entry reads as edited after an update.
 */
const DRAFT_PARTS = [filingPart, statusPart, tagsPart, textPart, schedulePart] as const

export const createEmptyItemDraft = (): ItemDraft =>
  Object.assign({}, ...DRAFT_PARTS.map((part) => part.empty())) as ItemDraft

export const itemDraftFromItem = (item: ItemRecord): ItemDraft =>
  Object.assign({}, ...DRAFT_PARTS.map((part) => part.fromItem(item))) as ItemDraft

/** The item fields a save sends for this draft, and what the dirty check compares. */
export const itemDraftRequest = (draft: ItemDraft): Record<string, unknown> =>
  Object.assign({}, ...DRAFT_PARTS.map((part) => part.toRequest(draft)))

const BLANK_CHECKS: readonly Pick<ItemDraftPart<ItemDraft>, "isBlank">[] = DRAFT_PARTS

/** Whether the user has put nothing into the draft. Presets do not count. */
export const isBlankItemDraft = (draft: ItemDraft): boolean =>
  BLANK_CHECKS.every((part) => part.isBlank?.(draft) ?? true)

const CONTENT_CHECKS: readonly Pick<ItemDraftPart<ItemDraft>, "holds">[] = DRAFT_PARTS

/**
 * Whether a save of this draft would store content. It is the item service's own rule
 * (`hasItemContent`) applied to a draft.
 */
export const draftHoldsContent = (draft: ItemDraft): boolean =>
  CONTENT_CHECKS.some((part) => part.holds?.(draft) ?? false)

/** Content first: text names an item when it has some, then what else it holds. */
const LIST_LABEL_PARTS = [textPart, statusPart, schedulePart] as const

/** A one-line label for an item in a list, from the first part that has one. */
export const itemListLabel = (item: ItemRecord): string => {
  for (const part of LIST_LABEL_PARTS) {
    const label = part.listLabel?.(item)
    if (label) return label
  }
  return "Untitled"
}
