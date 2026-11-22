import type { ItemRecord } from "@lib/db-items"

/**
 * One part of an item's draft: the fields a form holds for it, how a stored item
 * fills them, and what a save sends. A capability contributes one part; so does each
 * piece of taxonomy. `draftParts.ts` composes the parts into the whole draft, so a new
 * capability joins the form state, the dirty check, and the save request by adding
 * its part there.
 */
export interface ItemDraftPart<Slice extends object> {
  /** The slice for an item that holds nothing of this part. */
  empty: () => Slice
  fromItem: (item: ItemRecord) => Slice
  /**
   * The request fields a save sends for this part. A draft is dirty when these differ
   * from what was last saved, so form state that is not sent (an expanded field, a
   * pending label) must not appear here.
   */
  toRequest: (draft: Slice) => Record<string, unknown>
  /**
   * Whether the draft holds nothing the user put into this part. Leave it out for a
   * part that a view presets, such as the filing or status a new item starts with:
   * a preset alone never makes a draft worth keeping.
   */
  isBlank?: (draft: Slice) => boolean
  /**
   * For content: whether a save of this draft would store it. State and taxonomy
   * parts leave it out, because a status, a date, filing, and tags describe and
   * organize content and are not content.
   */
  holds?: (draft: Slice) => boolean
  /** A one-line label for lists, when the item holds this part. */
  listLabel?: (item: ItemRecord) => string | null
}

/**
 * What a part's editor control receives: its slice of the draft and a way to change
 * it. `onChange` takes a function of the current slice, so a control never writes over
 * an edit made to another part in the same tick.
 */
export interface DraftControlProps<Slice extends object> {
  draft: Slice
  onChange: (patch: (current: Slice) => Partial<Slice>) => void
}
