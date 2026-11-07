/**
 * Labels (workspaces, categories, statuses, tags) are stored as typed, without
 * surrounding whitespace. `labelKey` is their identity: two labels with the same
 * key are the same label. It matches the generated `label_key` column
 * (`lower(normalize(label, NFKC))`) for the labels the app stores.
 */
export const trimLabel = (value: string) => value.trim()

export const labelKey = (value: string) => value.trim().normalize("NFKC").toLowerCase()

export const sameLabel = (left: string, right: string) => labelKey(left) === labelKey(right)
