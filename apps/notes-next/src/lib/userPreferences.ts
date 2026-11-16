import type { UserPreferences } from "@lib/db-items"
import { clampStoredResultsColumnWidth } from "@/lib/resultsColumn"
import { clampMaxOpenItems, MAX_OPEN_ITEMS_DEFAULT } from "@/stores/openItems"

export const isPreferencesObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

export const normalizeUserPreferences = (value: unknown): UserPreferences =>
  isPreferencesObject(value) ? (value as UserPreferences) : {}

const sortPreferenceValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(sortPreferenceValue)
  }

  if (!isPreferencesObject(value)) {
    return value
  }

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nestedValue]) => [key, sortPreferenceValue(nestedValue)]),
  )
}

export const serializeUserPreferences = (preferences: UserPreferences) =>
  JSON.stringify(sortPreferenceValue(preferences))

export const getStoredResultsColumnWidth = (preferences: UserPreferences) => {
  const itemsAppPreferences = preferences.notesApp
  if (!isPreferencesObject(itemsAppPreferences)) return null

  const width = itemsAppPreferences.resultsColumnWidth
  if (typeof width !== "number" || !Number.isFinite(width)) {
    return null
  }

  return clampStoredResultsColumnWidth(width)
}

export const withResultsColumnWidthPreference = (
  preferences: UserPreferences,
  width: number,
): UserPreferences => ({
  ...preferences,
  notesApp: {
    ...(isPreferencesObject(preferences.notesApp) ? preferences.notesApp : {}),
    resultsColumnWidth: clampStoredResultsColumnWidth(width),
  },
})

export const getPasteUrlAsMarkdownPreference = (preferences: UserPreferences) => {
  const itemsAppPreferences = preferences.notesApp
  if (!isPreferencesObject(itemsAppPreferences)) return false

  return itemsAppPreferences.pasteUrlAsMarkdown === true
}

export const withPasteUrlAsMarkdownPreference = (
  preferences: UserPreferences,
  enabled: boolean,
): UserPreferences => ({
  ...preferences,
  notesApp: {
    ...(isPreferencesObject(preferences.notesApp) ? preferences.notesApp : {}),
    pasteUrlAsMarkdown: enabled,
  },
})

export const getMaxOpenItemsPreference = (preferences: UserPreferences) => {
  const itemsAppPreferences = preferences.notesApp
  if (!isPreferencesObject(itemsAppPreferences)) return MAX_OPEN_ITEMS_DEFAULT

  const value = itemsAppPreferences.maxOpenNotes
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return MAX_OPEN_ITEMS_DEFAULT
  }

  return clampMaxOpenItems(value)
}

export const withMaxOpenItemsPreference = (
  preferences: UserPreferences,
  value: number,
): UserPreferences => ({
  ...preferences,
  notesApp: {
    ...(isPreferencesObject(preferences.notesApp) ? preferences.notesApp : {}),
    maxOpenNotes: clampMaxOpenItems(value),
  },
})
