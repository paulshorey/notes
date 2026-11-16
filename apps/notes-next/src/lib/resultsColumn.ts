import { SIDEBAR_OVERLAY_MEDIA_QUERY } from "@/constants/items"

export const RESULTS_COLUMN_MIN_WIDTH = 222
export const RESULTS_COLUMN_DEFAULT_WIDTH = RESULTS_COLUMN_MIN_WIDTH
export const RESULTS_COLUMN_MAX_WIDTH = 720
export const FORM_COLUMN_MIN_WIDTH = 333
export const RESIZE_HANDLE_WIDTH = 8
export const RESIZE_DRAG_THRESHOLD = 4
export const RESULTS_DRAWER_TRANSITION_MS = 400

export const clampStoredResultsColumnWidth = (width: number) =>
  Math.round(Math.min(Math.max(width, RESULTS_COLUMN_MIN_WIDTH), RESULTS_COLUMN_MAX_WIDTH))

export const isResultsDrawerLayout = () =>
  typeof window !== "undefined" && window.matchMedia(SIDEBAR_OVERLAY_MEDIA_QUERY).matches
