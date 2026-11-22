import { hasText } from "@lib/db-items/contracts/item-capabilities"
import type { ItemRecord } from "@lib/db-items"
import { isKind, type ItemKindKey } from "@lib/db-items/contracts/item-kinds"
import { draftHoldsContent, isBlankItemDraft, type ItemDraft } from "@/capabilities/draftParts"
import { draftHasTimeBlock } from "@/capabilities/time/draft"

/** What a view's selection depends on besides the item itself. */
export interface ViewSelectionContext {
  /** Kinds the user chose to leave out of the notes view. */
  notesViewHiddenKinds: readonly ItemKindKey[]
}

/**
 * A view is a screen over some of the workspace's items. It is named after a kind and
 * decides for itself which items it lists (`selects`), so the same item appears in
 * every view that selects it, and opening it anywhere opens the same item.
 *
 * Add a view here and give its route a page under `app/(workspace)/`. The shell reads
 * this list for navigation and asks the active view which of the workspace's items
 * that screen lists.
 */
export interface ItemView {
  /** The kind the view is named after. It identifies the view; `selects` picks its items. */
  kind: ItemKindKey
  /** Whether this view lists the item. */
  selects: (item: ItemRecord, context: ViewSelectionContext) => boolean
  /**
   * Kinds the view lists that the user may leave out of it, because each has a view of
   * its own. They are listed unless hidden.
   */
  optionalKinds: readonly ItemKindKey[]
  /** Path of the view's page. */
  route: string
  /**
   * Whether this view makes a new item out of a draft. The item service accepts an
   * item holding any content, so this is the view's own rule about which content
   * starts one here. It applies to creating only: once an item is stored, its edits are
   * saved from every view.
   */
  canCreate: (draft: ItemDraft) => boolean
  /**
   * Whether the view always shows the editor for the active entry (`note`), or only
   * once the user opens an item in it. A view that always shows the editor takes over
   * whichever entry becomes active.
   */
  alwaysShowsEditor: boolean
  /**
   * The parts of an item this view prioritizes in the editor toolbar.
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
    // Everything with text is a note here, whatever else it is, except the kinds the
    // user left out.
    selects: (item, { notesViewHiddenKinds }) =>
      isKind(item, "note") && !notesViewHiddenKinds.some((kind) => isKind(item, kind)),
    optionalKinds: ["task", "time"],
    route: "/",
    // A note starts once the draft has text.
    canCreate: (draft) => hasText(draft.description),
    alwaysShowsEditor: true,
    // A note is text that gets organized.
    editorProminent: ["filing", "tags"],
  },
  {
    kind: "task",
    selects: (item) => isKind(item, "task"),
    optionalKinds: [],
    route: "/tasks",
    // A task is text with a status, so it starts once the draft has text.
    canCreate: (draft) => hasText(draft.description),
    alwaysShowsEditor: false,
    // A task is tracked by where it stands and when it is due.
    editorProminent: ["status", "schedule"],
    // A card added to a board column starts with that column's status.
    quickAddDefaults: ({ statusId }) => ({ selectedStatusId: statusId }),
  },
  {
    kind: "time",
    selects: (item) => isKind(item, "time"),
    optionalKinds: [],
    route: "/time",
    // A time block needs no text: its start and end are what it holds.
    canCreate: draftHasTimeBlock,
    alwaysShowsEditor: false,
    editorProminent: ["filing"],
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
