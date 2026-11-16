import type { ItemInput, ItemRecord } from "./items-app"

/**
 * What an item can hold beyond its identity, workspace, and taxonomy.
 *
 * Every capability is optional and independent. An item's perceived type ("note",
 * "task", ...) is a name for the combination it holds; it is computed, never stored.
 * Add a capability here once; saving, the client's save rule, and every other consumer
 * of this registry pick it up.
 */
export type ItemCapabilityKey = "text" | "schedule" | "status"

/** The fields capabilities read. Satisfied by a stored item and by a write request. */
export type ItemCapabilitySource = Pick<ItemRecord, "description" | "timeDue" | "timeRemind"> &
  (Pick<ItemRecord, "status"> | Pick<ItemInput, "statusId">)

export interface ItemCapability {
  key: ItemCapabilityKey
  /**
   * Content is what an item is about, and an item must hold at least one. The other
   * capabilities qualify content and cannot make an item on their own.
   */
  content: boolean
  isPresent: (item: ItemCapabilitySource) => boolean
}

export const hasText = (description: string | null | undefined): description is string =>
  typeof description === "string" && description.trim().length > 0

export const ITEM_CAPABILITIES: readonly ItemCapability[] = [
  { key: "text", content: true, isPresent: (item) => hasText(item.description) },
  {
    key: "schedule",
    content: false,
    isPresent: (item) => item.timeDue !== null || item.timeRemind !== null,
  },
  {
    key: "status",
    content: false,
    isPresent: (item) => ("status" in item ? item.status !== null : item.statusId !== null),
  },
]

/** The capabilities an item holds, in registry order. */
export const itemCapabilities = (item: ItemCapabilitySource): ItemCapabilityKey[] =>
  ITEM_CAPABILITIES.filter((capability) => capability.isPresent(item)).map(
    (capability) => capability.key,
  )

/** Whether an item holds anything that lets it exist: taxonomy and qualifiers do not. */
export const hasItemContent = (item: ItemCapabilitySource): boolean =>
  ITEM_CAPABILITIES.some((capability) => capability.content && capability.isPresent(item))

export const ITEM_CONTENT_REQUIRED_ERROR = "An item needs text before it can be saved."

export class ItemContentRequiredError extends Error {
  constructor() {
    super(ITEM_CONTENT_REQUIRED_ERROR)
  }
}

export const assertItemHasContent = (item: ItemCapabilitySource): void => {
  if (!hasItemContent(item)) throw new ItemContentRequiredError()
}
