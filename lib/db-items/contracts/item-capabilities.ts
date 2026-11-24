import type { ItemInput, ItemRecord } from "./items-app"
import {
  ITEM_MODEL,
  type ItemCapabilityKey,
  type ItemCapabilityRole,
  type ItemModelField,
  type ItemPresenceTest,
} from "./item-model"

/**
 * What an item can hold beyond its identity, workspace, and taxonomy, read from
 * `item-model.ts`. A capability is content or state. Content makes an item exist: an
 * item holds at least one. State describes an item and never keeps it alive, so a
 * status or a date alone is not an item. `item-kinds.ts` names the combinations.
 */
export type { ItemCapabilityKey, ItemCapabilityRole } from "./item-model"

/** The fields capabilities read. Satisfied by a stored item and by a write request. */
export type ItemCapabilitySource = Pick<ItemRecord, "description" | "timeDue" | "timeRemind"> & {
  timeStart?: string | null
  entryDate?: string | null
} & (Pick<ItemRecord, "status"> | Pick<ItemInput, "statusId">)

export interface ItemCapability {
  key: ItemCapabilityKey
  role: ItemCapabilityRole
  isPresent: (item: ItemCapabilitySource) => boolean
  /** Capabilities this one needs beside it. State without them is refused. */
  requires: readonly ItemCapabilityKey[]
}

export const hasText = (description: string | null | undefined): description is string =>
  typeof description === "string" && description.trim().length > 0

/** A model field's value on a stored item or a write request. */
const fieldValue = (item: ItemCapabilitySource, field: ItemModelField): unknown => {
  const values = item as unknown as Record<string, unknown>
  // A stored item names its status as a reference; a request names its id.
  if (field === "statusId" && "status" in item) return item.status
  return values[field]
}

const passes = (value: unknown, test: ItemPresenceTest) =>
  test === "nonblank" ? hasText(value as string | null | undefined) : value != null

export const ITEM_CAPABILITIES: readonly ItemCapability[] = ITEM_MODEL.capabilities.map(
  (capability) => ({
    key: capability.key,
    role: capability.role,
    requires: capability.requires,
    isPresent: (item) =>
      capability.presentWhenAny.some(({ field, test }) => passes(fieldValue(item, field), test)),
  }),
)

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

/** The first state an item holds without a capability that state requires, or null. */
export const missingRequirement = (
  item: ItemCapabilitySource,
): { key: ItemCapabilityKey; requires: ItemCapabilityKey } | null => {
  for (const capability of ITEM_CAPABILITIES) {
    if (!capability.isPresent(item)) continue
    const missing = capability.requires.find((key) => !hasItemCapability(item, key))
    if (missing) return { key: capability.key, requires: missing }
  }
  return null
}

export const ITEM_CONTENT_REQUIRED_ERROR = "An item needs content before it can be saved."

export class ItemRequirementError extends Error {
  constructor(
    readonly capability: ItemCapabilityKey,
    readonly requires: ItemCapabilityKey,
  ) {
    super(`An item needs ${requires} to have a ${capability}.`)
  }
}

export class ItemContentRequiredError extends Error {
  constructor() {
    super(ITEM_CONTENT_REQUIRED_ERROR)
  }
}

/** The save rules: an item holds content, and each state it holds has what it requires. */
export const assertItemHasContent = (item: ItemCapabilitySource): void => {
  if (!hasItemContent(item)) throw new ItemContentRequiredError()
  const missing = missingRequirement(item)
  if (missing) throw new ItemRequirementError(missing.key, missing.requires)
}
