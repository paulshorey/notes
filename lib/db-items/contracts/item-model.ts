/**
 * The item model: what an item can hold, what each combination is called, and what a
 * write does. It is data, so the same declaration drives the save rules in the service,
 * the kinds the views select by, and the JSON that `GET /api/items/model` serves to
 * scripts and agents (`generated/contracts/item-model.json` is the committed copy).
 *
 * Add a field, capability, or kind here. `item-capabilities.ts` and `item-kinds.ts`
 * read this file and hold no rule of their own.
 */

export type ItemCapabilityKey = "text" | "time" | "day" | "schedule" | "status"
export type ItemCapabilityRole = "content" | "state"
export type ItemKindKey = "note" | "task" | "time" | "journal"

/** A field of a write request. `statusId` reads a stored item's `status`. */
export type ItemModelField =
  | "description"
  | "timeStart"
  | "timeEnd"
  | "entryDate"
  | "timeDue"
  | "timeRemind"
  | "statusId"
  | "categoryId"
  | "subcategoryId"
  | "tagIds"

/** How a field counts as held: any value at all, or text that is not blank. */
export type ItemPresenceTest = "set" | "nonblank"

export interface ItemModelCapability {
  key: ItemCapabilityKey
  /** Content makes an item exist. State describes an item and never keeps it alive. */
  role: ItemCapabilityRole
  /** The fields the capability owns. Clearing all of them removes the capability. */
  fields: readonly ItemModelField[]
  /** The capability is held when any of these fields passes its test. */
  presentWhenAny: readonly { field: ItemModelField; test: ItemPresenceTest }[]
  /** Capabilities that must be held beside this one. A write that breaks it is refused. */
  requires: readonly ItemCapabilityKey[]
  description: string
}

export interface ItemModelKind {
  key: ItemKindKey
  /** An item is this kind while it holds every one of these capabilities. */
  holdsAll: readonly ItemCapabilityKey[]
  description: string
}

/** Deleted items wait in the trash this many days before they are removed for good. */
export const TRASH_RETENTION_DAYS = 30

export const ITEM_MODEL = {
  version: 1,
  capabilities: [
    {
      key: "text",
      role: "content",
      fields: ["description"],
      presentWhenAny: [{ field: "description", test: "nonblank" }],
      requires: [],
      description: "Authored text.",
    },
    {
      key: "time",
      role: "content",
      fields: ["timeStart", "timeEnd"],
      presentWhenAny: [{ field: "timeStart", test: "set" }],
      requires: [],
      description:
        "A time block: a start and an end, set together and in order. Given one, the other takes its value.",
    },
    {
      key: "day",
      role: "content",
      fields: ["entryDate"],
      presentWhenAny: [{ field: "entryDate", test: "set" }],
      requires: [],
      description: "The calendar day of a journal entry. A workspace has one entry per day.",
    },
    {
      key: "schedule",
      role: "state",
      fields: ["timeDue", "timeRemind"],
      presentWhenAny: [
        { field: "timeDue", test: "set" },
        { field: "timeRemind", test: "set" },
      ],
      requires: [],
      description: "A due time, a reminder time, or both.",
    },
    {
      key: "status",
      role: "state",
      fields: ["statusId"],
      presentWhenAny: [{ field: "statusId", test: "set" }],
      requires: ["text"],
      description: "One of the workspace's statuses. It tracks something written down.",
    },
  ],
  /** Where an item is filed. Taxonomy is neither content nor state and makes no kind. */
  taxonomy: {
    fields: ["categoryId", "subcategoryId", "tagIds"],
    description:
      "At most one category, at most one subcategory of that category, and any number of tags, all from the item's workspace.",
  },
  kinds: [
    { key: "note", holdsAll: ["text"], description: "An item with text." },
    {
      key: "task",
      holdsAll: ["text", "status"],
      description: "Text that is tracked by a status.",
    },
    { key: "time", holdsAll: ["time"], description: "An item with a time block." },
    { key: "journal", holdsAll: ["day"], description: "The journal entry of one day." },
  ],
  rules: {
    kinds:
      "A kind is computed from what the item holds and never stored. An item can be several kinds at once, and it stops being a kind when a capability that kind holds is removed.",
    create: {
      contentRequired: true,
      idempotency:
        "A create may name the item's uid. Repeating it stores nothing and answers 200 with the stored item instead of 201.",
    },
    update: {
      absentField: "unchanged",
      nullField: "cleared",
      version:
        "expectedTimeModified names the timeModified the caller last saw. A stale one writes nothing and answers 409 with the stored item.",
      contentRequired:
        "An update that would leave the item with no content is refused with content_required. Delete the item instead.",
      requirementMissing:
        "An update that would leave a state without a capability it requires is refused with requirement_missing. Clear that state in the same request.",
    },
    delete: {
      destination: "trash",
      retentionDays: TRASH_RETENTION_DAYS,
      vocabulary:
        "Deleting an item removes each category, subcategory, and tag that no item uses any more. Statuses are kept.",
    },
  },
} as const satisfies {
  version: number
  capabilities: readonly ItemModelCapability[]
  taxonomy: { fields: readonly ItemModelField[]; description: string }
  kinds: readonly ItemModelKind[]
  rules: unknown
}

/** What removing one capability from an item does, derived from the declarations. */
export interface ItemCapabilityRemoval {
  capability: ItemCapabilityKey
  /** Fields to send as null. */
  clearFields: readonly ItemModelField[]
  /** Kinds the item stops being. */
  kindsLost: ItemKindKey[]
  /** States that require this capability; the removal is refused while one is held. */
  refusedWhileHolding: ItemCapabilityKey[]
  /** True for content: removing the item's last content is refused. */
  refusedWhenLastContent: boolean
}

export const itemCapabilityRemovals = (): ItemCapabilityRemoval[] =>
  ITEM_MODEL.capabilities.map((capability) => ({
    capability: capability.key,
    clearFields: capability.fields,
    kindsLost: ITEM_MODEL.kinds
      .filter((kind) => (kind.holdsAll as readonly string[]).includes(capability.key))
      .map((kind) => kind.key),
    refusedWhileHolding: ITEM_MODEL.capabilities
      .filter((other) => (other.requires as readonly string[]).includes(capability.key))
      .map((other) => other.key),
    refusedWhenLastContent: capability.role === "content",
  }))

/** The model as served and committed: the declarations plus what they imply. */
export const itemModelDocument = () => ({
  ...ITEM_MODEL,
  removals: itemCapabilityRemovals(),
})
