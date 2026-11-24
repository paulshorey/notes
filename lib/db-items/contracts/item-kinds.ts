import { hasItemCapability, type ItemCapabilitySource } from "./item-capabilities"
import { ITEM_MODEL, type ItemKindKey } from "./item-model"

/**
 * A kind is a name for what an item holds, declared in `item-model.ts`. It is computed from the item every time and
 * never stored, so it cannot disagree with the content. An item can be several kinds at
 * once, and it stops being a kind when the content that made it one is removed.
 *
 * Views select their items by kind. Use a lowercase, singular name for
 * both the kind key and its display label, such as "note" or "task".
 */
export type { ItemKindKey } from "./item-model"

export interface ItemKind {
  key: ItemKindKey
  /** The kind's lowercase, singular display name matches its key. */
  label: ItemKindKey
  matches: (item: ItemCapabilitySource) => boolean
}

export const ITEM_KINDS: readonly ItemKind[] = ITEM_MODEL.kinds.map((kind) => ({
  key: kind.key,
  label: kind.key,
  matches: (item) => kind.holdsAll.every((capability) => hasItemCapability(item, capability)),
}))

/** The kinds an item is, in registry order. */
export const itemKinds = (item: ItemCapabilitySource): ItemKindKey[] =>
  ITEM_KINDS.filter((kind) => kind.matches(item)).map((kind) => kind.key)

export const isKind = (item: ItemCapabilitySource, key: ItemKindKey): boolean =>
  ITEM_KINDS.some((kind) => kind.key === key && kind.matches(item))
