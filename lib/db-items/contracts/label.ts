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

/**
 * The spelling the database stores during the label-casing rollout, mirroring the
 * `app_label_lowercase_v1` trigger: the lowercase spelling when that keeps the
 * label's key, otherwise the key itself when it is a valid label.
 */
export const rolloutLabelSpelling = (value: string) => {
  const typed = value.trim()
  const key = labelKey(typed)
  const lowered = typed.toLowerCase()
  if (labelKey(lowered) === key) return lowered
  if (key !== "" && key === key.trim()) return key
  return typed
}
