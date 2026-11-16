import type { ItemKindKey } from "@lib/db-items/contracts/item-kinds"

/**
 * A view is a screen over the items of one kind. The same item appears in every view
 * whose kind it is, and opening it anywhere opens the same item.
 *
 * Add a view here and give its route a page under `app/(workspace)/`. The shell reads
 * this list for navigation and uses the active view's kind to decide which of the
 * workspace's items that screen lists.
 */
export interface ItemView {
  kind: ItemKindKey
  /** Path of the view's page. */
  route: string
  /** Plural name shown in navigation. */
  label: string
}

export const ITEM_VIEWS: readonly ItemView[] = [{ kind: "note", route: "/", label: "Notes" }]

/** The view a path belongs to: the longest route that is the path or a parent of it. */
export const viewForPath = (pathname: string): ItemView => {
  const match = [...ITEM_VIEWS]
    .sort((left, right) => right.route.length - left.route.length)
    .find(
      (view) =>
        pathname === view.route || (view.route !== "/" && pathname.startsWith(`${view.route}/`)),
    )
  return match ?? ITEM_VIEWS[0]!
}
