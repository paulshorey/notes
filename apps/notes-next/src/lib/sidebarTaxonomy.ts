import type { NoteRecord, TaxonomyRecord } from "@lib/db-notes"
import { TAXONOMY_LEVEL_CATEGORY, TAXONOMY_LEVEL_GROUP } from "@lib/db-notes/contracts/notes-app"
import {
  childrenOfLevel,
  epicsOf,
  isDefaultNodeLabel,
  pathForGroup,
  type TaxonomyIndex,
} from "@/lib/taxonomyIndex"

export interface SidebarNoteItem {
  note: NoteRecord
  /** Set when the note's group is not the seeded default, so the row can badge it. */
  groupLabel: string | null
}

export interface CategoryNoteGroup {
  category: TaxonomyRecord
  items: SidebarNoteItem[]
  sortTime: number
}

export interface EpicNoteGroup {
  epic: TaxonomyRecord
  categories: CategoryNoteGroup[]
  items: SidebarNoteItem[]
  sortTime: number
}

export const noteSortTime = (note: NoteRecord): number => {
  if (!note.timeModified) return 0
  const time = Date.parse(note.timeModified)
  return Number.isFinite(time) ? time : 0
}

const itemsSortTime = (items: SidebarNoteItem[]): number =>
  items.reduce((latest, { note }) => Math.max(latest, noteSortTime(note)), 0)

const compareByLatestThenLabel = (
  left: { sortTime: number; label: string; id: number },
  right: { sortTime: number; label: string; id: number },
) =>
  right.sortTime - left.sortTime ||
  left.label.localeCompare(right.label, undefined, { sensitivity: "base" }) ||
  left.id - right.id

const toSidebarItem = (note: NoteRecord, group: TaxonomyRecord): SidebarNoteItem => ({
  note,
  groupLabel: isDefaultNodeLabel(TAXONOMY_LEVEL_GROUP, group.label) ? null : group.label,
})

/**
 * Epic → category tree for the sidebar. Notes are listed under their category;
 * group is a badge only and does not affect sort order. Notes sort by
 * `timeModified` descending. Categories (and epics) sort by the latest note
 * in that subtree, then by label.
 */
export const buildEpicNoteGroups = (
  index: TaxonomyIndex,
  notes: NoteRecord[],
): EpicNoteGroup[] => {
  const notesByGroup = new Map<number, NoteRecord[]>()
  for (const note of notes) {
    const bucket = notesByGroup.get(note.groupId)
    if (bucket) {
      bucket.push(note)
    } else {
      notesByGroup.set(note.groupId, [note])
    }
  }

  const sortNotes = (items: SidebarNoteItem[]) =>
    [...items].sort((left, right) => noteSortTime(right.note) - noteSortTime(left.note))

  return epicsOf(index)
    .map((epic) => {
      const categories = childrenOfLevel(index, epic.id)
        .filter((row) => row.level === TAXONOMY_LEVEL_CATEGORY)
        .map((category) => {
          const items = sortNotes(
            childrenOfLevel(index, category.id).flatMap((group) => {
              if (group.level !== TAXONOMY_LEVEL_GROUP) return []
              return (notesByGroup.get(group.id) ?? []).map((note) => toSidebarItem(note, group))
            }),
          )
          return { category, items, sortTime: itemsSortTime(items) }
        })

      categories.sort((left, right) =>
        compareByLatestThenLabel(
          { sortTime: left.sortTime, label: left.category.label, id: left.category.id },
          { sortTime: right.sortTime, label: right.category.label, id: right.category.id },
        ),
      )

      const items = categories.flatMap((entry) => entry.items)
      return { epic, categories, items, sortTime: itemsSortTime(items) }
    })
    .sort((left, right) =>
      compareByLatestThenLabel(
        { sortTime: left.sortTime, label: left.epic.label, id: left.epic.id },
        { sortTime: right.sortTime, label: right.epic.label, id: right.epic.id },
      ),
    )
}

export const epicGroupById = (
  tree: EpicNoteGroup[],
  epicId: number | null,
): EpicNoteGroup | null => {
  if (epicId === null) return tree[0] ?? null
  return tree.find((entry) => entry.epic.id === epicId) ?? tree[0] ?? null
}

export const notesMatchingTag = (
  notes: NoteRecord[],
  selectedTagId: number | null,
): NoteRecord[] =>
  selectedTagId === null
    ? notes
    : notes.filter((note) => note.tags.some((tag) => tag.id === selectedTagId))

/** Path string for a group, used by the sidebar move picker. */
export const groupPathLabel = (index: TaxonomyIndex, group: TaxonomyRecord): string => {
  const path = pathForGroup(index, group.id)
  return path === null
    ? group.label
    : `${path.epic.label} → ${path.category.label} → ${path.group.label}`
}
