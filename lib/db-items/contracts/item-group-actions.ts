import type { CategoryRecord, ItemRecord } from "./items-app"

/** A group selects persisted items; it never supplies a default category. */
export interface CategoryItemGroupTarget {
  kind: "category"
  categoryId: number
}

/** The items filed in one subcategory. A category target includes them too. */
export interface SubcategoryItemGroupTarget {
  kind: "subcategory"
  subcategoryId: number
}

export interface UncategorizedItemGroupTarget {
  kind: "uncategorized"
}

export interface SingleItemGroupTarget {
  kind: "item"
  itemId: number
}

export type ItemGroupTarget =
  | CategoryItemGroupTarget
  | SubcategoryItemGroupTarget
  | UncategorizedItemGroupTarget
  | SingleItemGroupTarget

export interface ItemGroupSelection {
  workspaceId: number
  target: ItemGroupTarget
}

export interface RenameItemGroupAction {
  kind: "rename"
  label: string
}

export interface DeleteItemGroupAction {
  kind: "delete"
  deleteItems: boolean
}

/**
 * Put a group somewhere else in the hierarchy, keeping its items in it.
 *
 * A subcategory moves under `categoryId`, or with `null` becomes a category itself. A
 * category moves under `categoryId` and becomes its subcategory, which is allowed only
 * when it has no subcategories of its own, because the hierarchy is two levels deep.
 */
export interface MoveItemGroupAction {
  kind: "move"
  categoryId: number | null
}

export interface MoveToWorkspaceAction {
  kind: "move-to-workspace"
  destinationWorkspaceId: number
}

export type ItemGroupAction =
  | RenameItemGroupAction
  | DeleteItemGroupAction
  | MoveItemGroupAction
  | MoveToWorkspaceAction

export interface PreviewItemGroupRequest {
  userId: number
  selection: ItemGroupSelection
}

export interface ExecuteItemGroupActionRequest {
  userId: number
  selection: ItemGroupSelection
  action: ItemGroupAction
  snapshot: string
}

export interface ItemGroupPreview {
  snapshot: string
  label: string
  itemIds: number[]
  itemCount: number
  textItemCount: number
  /** Subcategories a category target removes with it. Zero for other targets. */
  subcategoryCount: number
}

/** `category` is the affected category, or the parent of an affected subcategory. */
export interface ItemGroupActionResponse {
  items: ItemRecord[]
  deletedItemIds: number[]
  workspaceMove?: { destinationWorkspaceId: number; itemIds: number[] }
  cleanup?: { workspaceRemoved: boolean }
  category: CategoryRecord | null
  removedCategoryId: number | null
  removedSubcategoryId: number | null
}
