import { hasText } from "@lib/db-items/contracts/item-capabilities"
import type { ItemKindKey } from "@lib/db-items/contracts/item-kinds"
import { draftHoldsContent, isBlankItemDraft, type ItemDraft } from "@/capabilities/draftParts"

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
  /**
   * Whether this view makes a new item out of a draft. The item service accepts an
   * item holding any content, so this is the view's own rule about what is worth
   * starting. It applies to creating only: once an item is stored, its edits are saved
   * from every view.
   */
  canCreate: (draft: ItemDraft) => boolean
  /**
   * Whether the view always shows the editor for the active entry (Notes), or only
   * once the user opens an item in it. A view that always shows the editor takes over
   * whichever entry becomes active.
   */
  alwaysShowsEditor: boolean
  /**
   * The parts of an item this view is about. Its editor shows these in the toolbar;
   * the other parts stay reachable in the More menu.
   */
  editorProminent: readonly EditorPart[]
  /**
   * What a quick-add in this view puts on the new item besides the typed text, given
   * where in the view it was added.
   */
  quickAddDefaults?: (context: { statusId: number | null }) => Partial<ItemDraft>
}

/** A part of an item the editor has a control for, besides its text. */
export type EditorPart = "filing" | "tags" | "status" | "schedule"

/** The view an entry belongs to when nothing says otherwise. */
export const DEFAULT_VIEW_KIND: ItemKindKey = "note"

export const ITEM_VIEWS: readonly ItemView[] = [
  {
    kind: "note",
    route: "/",
    label: "Notes",
    // Notes captures text, so a note starts once it has some.
    canCreate: (draft) => hasText(draft.description),
    alwaysShowsEditor: true,
    // A note is text that gets organized.
    editorProminent: ["filing", "tags"],
  },
  {
    kind: "task",
    route: "/tasks",
    label: "Tasks",
    // A task may have no text: a date alone is worth starting one.
    canCreate: draftHoldsContent,
    alwaysShowsEditor: false,
    // A task is tracked by where it stands and when it is due.
    editorProminent: ["status", "schedule"],
    // A card added to a board column starts with that column's status.
    quickAddDefaults: ({ statusId }) => ({ selectedStatusId: statusId }),
  },
]

export const viewForKind = (kind: ItemKindKey): ItemView =>
  ITEM_VIEWS.find((view) => view.kind === kind) ?? ITEM_VIEWS[0]!

/** What saving an entry does to the stored item, or null when there is nothing to do. */
export type EntrySaveAction = "create" | "update" | "delete"

/**
 * What a save of this entry does.
 *
 * A never-saved draft is created when the view it was opened in would start an item
 * from it. A preset alone, such as the status of the column it was opened from, starts
 * nothing in any view.
 *
 * A stored item's edits are always saved, whichever view made them. If the edit
 * leaves the item holding no content at all, saving it deletes the item: an item
 * without content is not kept.
 */
export const entrySaveAction = (entry: {
  view: ItemKindKey
  form: ItemDraft
  itemId: number | null
}): EntrySaveAction | null => {
  if (entry.itemId !== null) return draftHoldsContent(entry.form) ? "update" : "delete"
  if (isBlankItemDraft(entry.form)) return null
  return viewForKind(entry.view).canCreate(entry.form) ? "create" : null
}

/** Whether a save of this entry would send anything. */
export const canSaveEntry = (entry: Parameters<typeof entrySaveAction>[0]): boolean =>
  entrySaveAction(entry) !== null

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
