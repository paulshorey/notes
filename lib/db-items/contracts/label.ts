/**
 * Labels (workspaces, categories, statuses, tags) are stored as typed, without
 * surrounding whitespace. `labelKey` is their identity: two labels with the same
 * key are the same label. It matches the generated `label_key` column,
 * `app_label_key_v1(label)`: NFKC, then locale-independent Unicode lowercasing
 * (the ICU root collation in SQL, `toLowerCase()` here).
 */
export const trimLabel = (value: string) => value.trim()

export const labelKey = (value: string) => value.trim().normalize("NFKC").toLowerCase()

export const sameLabel = (left: string, right: string) => labelKey(left) === labelKey(right)
