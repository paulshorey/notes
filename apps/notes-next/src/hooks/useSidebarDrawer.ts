import { useCallback, useEffect, useState } from "react"
import { MOBILE_RESULTS_MEDIA_QUERY, SIDEBAR_OVERLAY_MEDIA_QUERY } from "@/constants/notes"
import { useNotesAppStore } from "@/stores/notesAppStore"

type SidebarLayout = "mobile" | "tablet" | "desktop"

export function useSidebarDrawer() {
  const [layout, setLayout] = useState<SidebarLayout>("desktop")
  const open = useNotesAppStore((state) => state.resultsListVisible)
  const setOpen = useNotesAppStore((state) => state.setResultsListVisible)
  const drawerMode = layout !== "desktop"

  useEffect(() => {
    const mobileQuery = window.matchMedia(MOBILE_RESULTS_MEDIA_QUERY)
    const drawerQuery = window.matchMedia(SIDEBAR_OVERLAY_MEDIA_QUERY)

    const syncSidebarMode = () => {
      setLayout(mobileQuery.matches ? "mobile" : drawerQuery.matches ? "tablet" : "desktop")
      // Each layout starts in its default state, including after resizing.
      setOpen(!drawerQuery.matches)
    }

    syncSidebarMode()
    mobileQuery.addEventListener("change", syncSidebarMode)
    drawerQuery.addEventListener("change", syncSidebarMode)
    return () => {
      mobileQuery.removeEventListener("change", syncSidebarMode)
      drawerQuery.removeEventListener("change", syncSidebarMode)
    }
  }, [setOpen])

  const closeIfDrawer = useCallback(() => {
    if (drawerMode) {
      setOpen(false)
    }
  }, [drawerMode, setOpen])

  return { layout, drawerMode, open, setOpen, closeIfDrawer }
}
