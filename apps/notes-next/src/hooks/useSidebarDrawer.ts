import { useCallback, useEffect, useState } from "react"
import { SIDEBAR_OVERLAY_MEDIA_QUERY } from "@/constants/notes"

export function useSidebarDrawer() {
  const [drawerMode, setDrawerMode] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const mediaQuery = window.matchMedia(SIDEBAR_OVERLAY_MEDIA_QUERY)

    const syncSidebarMode = (matches: boolean) => {
      setDrawerMode(matches)
      if (!matches) {
        setOpen(false)
      }
    }

    syncSidebarMode(mediaQuery.matches)

    const handleChange = (event: MediaQueryListEvent) => {
      syncSidebarMode(event.matches)
    }

    mediaQuery.addEventListener("change", handleChange)
    return () => {
      mediaQuery.removeEventListener("change", handleChange)
    }
  }, [])

  const closeIfDrawer = useCallback(() => {
    if (drawerMode) {
      setOpen(false)
    }
  }, [drawerMode])

  return { drawerMode, open, setOpen, closeIfDrawer }
}
