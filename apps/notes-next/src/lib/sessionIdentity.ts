/** Accept existing signed sessions during the internal domain rename. */
export const readItemsUserId = (identity: Record<string, unknown>) => {
  const value = identity.itemsUserId ?? identity.notesUserId
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null
}
