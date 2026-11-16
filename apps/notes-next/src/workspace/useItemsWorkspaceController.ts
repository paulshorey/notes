"use client"

import { useAccountActions } from "./useAccountActions"
import { useItemLists } from "./useItemLists"
import { useItemSaveEngine } from "./useItemSaveEngine"
import { useOpenItemEntries } from "./useOpenItemEntries"
import { useResultsColumnLayout } from "./useResultsColumnLayout"
import { useSessionLifecycle } from "./useSessionLifecycle"
import { useTaxonomyActions } from "./useTaxonomyActions"
import { useWorkspaceData } from "./useWorkspaceData"
import { useWorkspaceState } from "./useWorkspaceState"

/**
 * Everything a signed-in or visitor session needs, composed from one hook per concern.
 *
 * Each hook receives what the hooks before it produced and adds its own part, so the
 * order below is the dependency order: state, layout, data loading, the save engine,
 * the open-entry ring, derived lists, session start-up, then the user's actions.
 * Mount it once, through `ItemsWorkspaceProvider`: the save engine keeps in-flight
 * requests and timers in refs that must outlive any single view.
 */
export function useItemsWorkspaceController() {
  const state = useWorkspaceState()
  const layout = useResultsColumnLayout(state)
  const data = useWorkspaceData({ ...state, ...layout })
  const engine = useItemSaveEngine({ ...state, ...data })
  const entries = useOpenItemEntries({ ...state, ...data, ...engine })
  const lists = useItemLists({ ...state, ...data, ...entries })
  const session = useSessionLifecycle({ ...state, ...layout, ...data, ...engine, ...entries })
  const account = useAccountActions({
    ...state,
    ...layout,
    ...data,
    ...engine,
    ...entries,
    ...lists,
  })
  const taxonomy = useTaxonomyActions({ ...state, ...data, ...engine, ...entries, ...lists })

  return {
    ...state,
    ...layout,
    ...data,
    ...engine,
    ...entries,
    ...lists,
    ...session,
    ...account,
    ...taxonomy,
  }
}

export type ItemsWorkspace = ReturnType<typeof useItemsWorkspaceController>
