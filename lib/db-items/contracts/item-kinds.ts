import { hasItemCapability, type ItemCapabilitySource } from "./item-capabilities"

/**
 * A kind is a name for what an item holds. It is computed from the item every time and
 * never stored, so it cannot disagree with the content. An item can be several kinds at
 * once, and it stops being a kind when the content that made it one is removed.
 *
 * Each kind is the selection rule of one view: Notes lists the items of kind "note",
 * Tasks the items of kind "task". Add a kind here once and give it a view.
 */
export type ItemKindKey = "note" | "task"

export interface ItemKind {
  key: ItemKindKey
  /** Singular display name. */
  label: string
  matches: (item: ItemCapabilitySource) => boolean
}

export const ITEM_KINDS: readonly ItemKind[] = [
  { key: "note", label: "Note", matches: (item) => hasItemCapability(item, "text") },
  {
    key: "task",
    label: "Task",
    matches: (item) => hasItemCapability(item, "status") || hasItemCapability(item, "schedule"),
  },
]

/** The kinds an item is, in registry order. Empty only for an item that holds nothing. */
export const itemKinds = (item: ItemCapabilitySource): ItemKindKey[] =>
  ITEM_KINDS.filter((kind) => kind.matches(item)).map((kind) => kind.key)

export const isKind = (item: ItemCapabilitySource, key: ItemKindKey): boolean =>
  ITEM_KINDS.some((kind) => kind.key === key && kind.matches(item))
