import { useCallback, useEffect, useState } from "react"
import { SIDEBAR_OVERLAY_MEDIA_QUERY } from "@/constants/notes"
import { useNotesAppStore } from "@/stores/notesAppStore"

export function useSidebarDrawer() {
  const [drawerMode, setDrawerMode] = useState(false)
  const open = useNotesAppStore((state) => state.resultsListVisible)
  const setOpen = useNotesAppStore((state) => state.setResultsListVisible)

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
