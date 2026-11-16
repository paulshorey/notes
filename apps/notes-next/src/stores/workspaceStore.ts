import { create } from "zustand"
import type { SetStateAction } from "react"
import type {
  CategoryRecord,
  ItemRecord,
  StatusRecord,
  TagRecord,
  UserPreferences,
  UserSummary,
  WorkspaceRecord,
} from "@lib/db-items"

/**
 * What the server holds for the signed-in user and the active workspace: the account,
 * its workspaces, and the active workspace's items and vocabulary. Every view reads
 * the same copy, and the workspace provider is the only writer.
 *
 * `items` holds every item of the workspace, whatever it contains. A view lists the
 * ones of its kind.
 */
interface WorkspaceData {
  user: UserSummary | null
  userPreferences: UserPreferences
  workspaces: WorkspaceRecord[]
  activeWorkspaceId: number | null
  items: ItemRecord[]
  categories: CategoryRecord[]
  statuses: StatusRecord[]
  tags: TagRecord[]
}

/** Takes a value or a function of the current value, like a React state setter. */
type Setter<Value> = (next: SetStateAction<Value>) => void

type WorkspaceSetters = {
  [Key in keyof WorkspaceData as `set${Capitalize<Key>}`]: Setter<WorkspaceData[Key]>
}

const emptyWorkspaceData = (): WorkspaceData => ({
  user: null,
  userPreferences: {},
  workspaces: [],
  activeWorkspaceId: null,
  items: [],
  categories: [],
  statuses: [],
  tags: [],
})

type WorkspaceStore = WorkspaceData &
  WorkspaceSetters & {
    /** Forget everything, as before any session has loaded. */
    reset: () => void
  }

export const useWorkspaceStore = create<WorkspaceStore>((set) => {
  const setter =
    <Key extends keyof WorkspaceData>(key: Key): Setter<WorkspaceData[Key]> =>
    (next) =>
      set((state) => {
        const current = state[key] as WorkspaceData[Key]
        const value =
          typeof next === "function"
            ? (next as (current: WorkspaceData[Key]) => WorkspaceData[Key])(current)
            : next
        return Object.is(value, current) ? state : ({ [key]: value } as Partial<WorkspaceData>)
      })

  return {
    ...emptyWorkspaceData(),
    reset: () => set(emptyWorkspaceData()),
    setUser: setter("user"),
    setUserPreferences: setter("userPreferences"),
    setWorkspaces: setter("workspaces"),
    setActiveWorkspaceId: setter("activeWorkspaceId"),
    setItems: setter("items"),
    setCategories: setter("categories"),
    setStatuses: setter("statuses"),
    setTags: setter("tags"),
  }
})
