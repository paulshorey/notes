"use client"

import { type CSSProperties, type PointerEvent, useCallback, useEffect, useMemo } from "react"
import {
  FORM_COLUMN_MIN_WIDTH,
  RESIZE_DRAG_THRESHOLD,
  RESIZE_HANDLE_WIDTH,
  RESULTS_COLUMN_DEFAULT_WIDTH,
  RESULTS_COLUMN_MAX_WIDTH,
  RESULTS_COLUMN_MIN_WIDTH,
  RESULTS_DRAWER_TRANSITION_MS,
  clampStoredResultsColumnWidth,
  isResultsDrawerLayout,
} from "@/lib/resultsColumn"
import {
  getStoredResultsColumnWidth,
  withResultsColumnWidthPreference,
} from "@/lib/userPreferences"
import type { WorkspaceStateOutput } from "./useWorkspaceState"

export function useResultsColumnLayout(ctx: WorkspaceStateOutput) {
  const {
    contentRef,
    drawerMode,
    preferredResultsColumnWidth,
    resizeStateRef,
    resultsColumnWidth,
    resultsListVisible,
    resultsOverlayMounted,
    resultsOverlayTimeoutRef,
    setPreferredResultsColumnWidth,
    setResultsColumnWidth,
    setResultsListVisible,
    setResultsOverlayMounted,
    setUserPreferences,
  } = ctx

  const clampResultsColumnWidth = useCallback(
    (width: number) => {
      const contentWidth =
        contentRef.current?.getBoundingClientRect().width ??
        (typeof window === "undefined" ? RESULTS_COLUMN_DEFAULT_WIDTH : window.innerWidth)
      const availableWidth = contentWidth - FORM_COLUMN_MIN_WIDTH - RESIZE_HANDLE_WIDTH
      const maxWidth = Math.max(
        RESULTS_COLUMN_MIN_WIDTH,
        Math.min(RESULTS_COLUMN_MAX_WIDTH, availableWidth),
      )

      return Math.round(Math.min(Math.max(width, RESULTS_COLUMN_MIN_WIDTH), maxWidth))
    },
    [contentRef],
  )

  const resultsColumnStyle = useMemo<CSSProperties>(
    () => ({
      flexBasis: resultsColumnWidth,
      width: resultsColumnWidth,
    }),
    [resultsColumnWidth],
  )

  const clearResultsOverlayTimeout = useCallback(() => {
    if (resultsOverlayTimeoutRef.current === null) return

    window.clearTimeout(resultsOverlayTimeoutRef.current)
    resultsOverlayTimeoutRef.current = null
  }, [resultsOverlayTimeoutRef])

  const updateResultsColumnWidth = (width: number) => {
    const nextPreferredWidth = clampStoredResultsColumnWidth(width)
    setResultsListVisible(true)
    setPreferredResultsColumnWidth(nextPreferredWidth)
    setResultsColumnWidth(clampResultsColumnWidth(nextPreferredWidth))
    setUserPreferences((current) =>
      getStoredResultsColumnWidth(current) === nextPreferredWidth
        ? current
        : withResultsColumnWidthPreference(current, nextPreferredWidth),
    )
  }

  const handleResizePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    resizeStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: resultsListVisible ? resultsColumnWidth : RESULTS_COLUMN_MIN_WIDTH,
      dragged: false,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handleResizePointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (isResultsDrawerLayout()) return

    const resizeState = resizeStateRef.current
    if (!resizeState || resizeState.pointerId !== event.pointerId) return

    const delta = resizeState.startX - event.clientX
    if (!resizeState.dragged && Math.abs(delta) < RESIZE_DRAG_THRESHOLD) return

    resizeState.dragged = true
    updateResultsColumnWidth(resizeState.startWidth + delta)
  }

  const handleResizePointerUp = (event: PointerEvent<HTMLButtonElement>) => {
    const resizeState = resizeStateRef.current
    if (!resizeState || resizeState.pointerId !== event.pointerId) return

    resizeStateRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const handleResizePointerCancel = (event: PointerEvent<HTMLButtonElement>) => {
    resizeStateRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const handleResultsOverlayClick = useCallback(() => {
    setResultsListVisible(false)
  }, [setResultsListVisible])

  useEffect(() => {
    if (resultsListVisible) {
      clearResultsOverlayTimeout()
      setResultsOverlayMounted(drawerMode)
      return
    }

    if (!resultsOverlayMounted) return

    clearResultsOverlayTimeout()
    resultsOverlayTimeoutRef.current = window.setTimeout(() => {
      resultsOverlayTimeoutRef.current = null
      setResultsOverlayMounted(false)
    }, RESULTS_DRAWER_TRANSITION_MS)

    return clearResultsOverlayTimeout
  }, [
    clearResultsOverlayTimeout,
    drawerMode,
    resultsOverlayMounted,
    resultsListVisible,
    resultsOverlayTimeoutRef,
    setResultsOverlayMounted,
  ])

  useEffect(() => clearResultsOverlayTimeout, [clearResultsOverlayTimeout])

  useEffect(() => {
    if (!resultsListVisible) return

    const handleDocumentKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && isResultsDrawerLayout()) {
        setResultsListVisible(false)
      }
    }

    document.addEventListener("keydown", handleDocumentKeyDown)
    return () => {
      document.removeEventListener("keydown", handleDocumentKeyDown)
    }
  }, [resultsListVisible, setResultsListVisible])

  useEffect(() => {
    const handleWindowResize = () => {
      setResultsColumnWidth(clampResultsColumnWidth(preferredResultsColumnWidth))
    }

    window.addEventListener("resize", handleWindowResize)
    return () => window.removeEventListener("resize", handleWindowResize)
  }, [clampResultsColumnWidth, preferredResultsColumnWidth, setResultsColumnWidth])

  return {
    clampResultsColumnWidth,
    resultsColumnStyle,
    clearResultsOverlayTimeout,
    updateResultsColumnWidth,
    handleResizePointerDown,
    handleResizePointerMove,
    handleResizePointerUp,
    handleResizePointerCancel,
    handleResultsOverlayClick,
  }
}

export type ResultsColumnLayoutOutput = ReturnType<typeof useResultsColumnLayout>
