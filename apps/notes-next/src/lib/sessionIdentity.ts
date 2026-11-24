/**
 * The user id of a signed session. A cookie that names it `notesUserId` is still read,
 * so the visitor it belongs to keeps their items; the next refresh writes `itemsUserId`.
 */
export const readItemsUserId = (identity: Record<string, unknown>) => {
  const value = identity.itemsUserId ?? identity.notesUserId
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null
}
