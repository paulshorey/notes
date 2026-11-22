import type { ItemInput, ItemRecord } from "./items-app"

/**
 * What an item can hold beyond its identity, workspace, and taxonomy.
 *
 * A capability is content or state. Content makes an item exist: an item holds at
 * least one. State describes an item and never keeps it alive, so a status or a date
 * alone is not an item. Add a capability here once; saving and every other consumer of
 * this registry pick it up. `item-kinds.ts` names the combinations ("note", "task", ...).
 */
export type ItemCapabilityKey = "text" | "schedule" | "status"

export type ItemCapabilityRole = "content" | "state"

/** The fields capabilities read. Satisfied by a stored item and by a write request. */
export type ItemCapabilitySource = Pick<ItemRecord, "description" | "timeDue" | "timeRemind"> &
  (Pick<ItemRecord, "status"> | Pick<ItemInput, "statusId">)

export interface ItemCapability {
  key: ItemCapabilityKey
  role: ItemCapabilityRole
  isPresent: (item: ItemCapabilitySource) => boolean
}

export const hasText = (description: string | null | undefined): description is string =>
  typeof description === "string" && description.trim().length > 0

export const ITEM_CAPABILITIES: readonly ItemCapability[] = [
  { key: "text", role: "content", isPresent: (item) => hasText(item.description) },
  {
    key: "schedule",
    role: "state",
    isPresent: (item) => item.timeDue !== null || item.timeRemind !== null,
  },
  {
    key: "status",
    role: "state",
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
 * The save rule: an item must hold content. State and taxonomy describe and organize
 * content and are not content, so a status, a date, a category, or tags alone do not
 * make an item.
 */
export const hasItemContent = (item: ItemCapabilitySource): boolean =>
  ITEM_CAPABILITIES.some(
    (capability) => capability.role === "content" && capability.isPresent(item),
  )

export const ITEM_CONTENT_REQUIRED_ERROR = "An item needs content before it can be saved."

export class ItemContentRequiredError extends Error {
  constructor() {
    super(ITEM_CONTENT_REQUIRED_ERROR)
  }
}

export const assertItemHasContent = (item: ItemCapabilitySource): void => {
  if (!hasItemContent(item)) throw new ItemContentRequiredError()
}
