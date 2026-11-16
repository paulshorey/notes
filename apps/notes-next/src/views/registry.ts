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
   * Whether this view saves a draft in its current state. The item service accepts an
   * item holding any capability, so this is the view's own rule about what is worth
   * keeping; the save engine asks the active view and holds no rule of its own.
   */
  canSave: (draft: ItemDraft) => boolean
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
    // Notes captures text, so a draft is worth saving once it has some.
    canSave: (draft) => hasText(draft.description),
    alwaysShowsEditor: true,
    // A note is text that gets organized.
    editorProminent: ["filing", "tags"],
  },
  {
    kind: "task",
    route: "/tasks",
    label: "Tasks",
    // A task may have no text: a status or a date alone is worth keeping.
    canSave: draftHoldsContent,
    alwaysShowsEditor: false,
    // A task is tracked by where it stands and when it is due.
    editorProminent: ["status", "schedule"],
    // A card added to a board column starts with that column's status.
    quickAddDefaults: ({ statusId }) => ({ selectedStatusId: statusId }),
  },
]

export const viewForKind = (kind: ItemKindKey): ItemView =>
  ITEM_VIEWS.find((view) => view.kind === kind) ?? ITEM_VIEWS[0]!

/**
 * Whether an entry's unsaved edits are saved. The entry carries the view it was last
 * opened in, and that view's rule decides: an edit is judged by the view it was made
 * in, whichever view is on screen when the save runs.
 */
export const canSaveEntry = (entry: {
  view: ItemKindKey
  form: ItemDraft
  itemId: number | null
}): boolean => {
  // A never-saved draft becomes an item only once the user has put something into it.
  // A preset alone, such as the status of the column it was opened from, creates
  // nothing in any view.
  if (entry.itemId === null && isBlankItemDraft(entry.form)) return false
  return viewForKind(entry.view).canSave(entry.form)
}

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
