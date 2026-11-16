import type { ItemInput, ItemRecord } from "./items-app"

/**
 * What an item can hold beyond its identity, workspace, and taxonomy.
 *
 * Every capability is optional and independent, and none is required: an item may hold
 * any combination. Add a capability here once; saving and every other consumer of this
 * registry pick it up. `item-kinds.ts` names the combinations ("note", "task", ...).
 */
export type ItemCapabilityKey = "text" | "schedule" | "status"

/** The fields capabilities read. Satisfied by a stored item and by a write request. */
export type ItemCapabilitySource = Pick<ItemRecord, "description" | "timeDue" | "timeRemind"> &
  (Pick<ItemRecord, "status"> | Pick<ItemInput, "statusId">)

export interface ItemCapability {
  key: ItemCapabilityKey
  isPresent: (item: ItemCapabilitySource) => boolean
}

export const hasText = (description: string | null | undefined): description is string =>
  typeof description === "string" && description.trim().length > 0

export const ITEM_CAPABILITIES: readonly ItemCapability[] = [
  { key: "text", isPresent: (item) => hasText(item.description) },
  {
    key: "schedule",
    isPresent: (item) => item.timeDue !== null || item.timeRemind !== null,
  },
  {
    key: "status",
    isPresent: (item) => ("status" in item ? item.status !== null : item.statusId !== null),
  },
]

/** The capabilities an item holds, in registry order. */
export const itemCapabilities = (item: ItemCapabilitySource): ItemCapabilityKey[] =>
  ITEM_CAPABILITIES.filter((capability) => capability.isPresent(item)).map(
    (capability) => capability.key,
  )

export const hasItemCapability = (item: ItemCapabilitySource, key: ItemCapabilityKey): boolean =>
  ITEM_CAPABILITIES.some((capability) => capability.key === key && capability.isPresent(item))

/**
 * The save rule: an item must hold at least one capability. Taxonomy organizes content
 * and is not content, so a workspace, categories, and tags alone do not make an item.
 */
export const hasItemContent = (item: ItemCapabilitySource): boolean =>
  ITEM_CAPABILITIES.some((capability) => capability.isPresent(item))

export const ITEM_CONTENT_REQUIRED_ERROR = "An item needs content before it can be saved."

export class ItemContentRequiredError extends Error {
  constructor() {
    super(ITEM_CONTENT_REQUIRED_ERROR)
  }
}

export const assertItemHasContent = (item: ItemCapabilitySource): void => {
  if (!hasItemContent(item)) throw new ItemContentRequiredError()
}
