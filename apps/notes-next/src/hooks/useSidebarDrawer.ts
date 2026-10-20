import { useCallback, useEffect, useState } from "react"
import { SIDEBAR_OVERLAY_MEDIA_QUERY } from "@/constants/items"
import { useItemsAppStore } from "@/stores/itemsAppStore"

export function useSidebarDrawer() {
  const [drawerMode, setDrawerMode] = useState(false)
  const open = useItemsAppStore((state) => state.resultsListVisible)
  const setOpen = useItemsAppStore((state) => state.setResultsListVisible)

  useEffect(() => {
    const drawerQuery = window.matchMedia(SIDEBAR_OVERLAY_MEDIA_QUERY)

    const syncSidebarMode = () => {
      setDrawerMode(drawerQuery.matches)
      // Apply the default only when crossing between drawer and desktop modes.
      setOpen(!drawerQuery.matches)
    }

    syncSidebarMode()
    drawerQuery.addEventListener("change", syncSidebarMode)
    return () => {
      drawerQuery.removeEventListener("change", syncSidebarMode)
    }
  }, [setOpen])

  const closeIfDrawer = useCallback(() => {
    if (drawerMode) {
      setOpen(false)
    }
  }, [drawerMode, setOpen])

  return { drawerMode, open, setOpen, closeIfDrawer }
}
