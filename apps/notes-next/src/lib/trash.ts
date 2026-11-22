import type { TrashedItemRecord } from "@lib/db-items/contracts/items-app"

/** Where a trashed item was filed and when it was deleted, for the line under its title. */
export const trashedItemDetail = (item: TrashedItemRecord): string =>
  [
    item.workspaceLabel,
    [item.category, item.subcategory].filter(Boolean).join(" / "),
    item.status,
    `deleted ${new Date(item.timeDeleted).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`,
  ]
    .filter(Boolean)
    .join(" · ")
