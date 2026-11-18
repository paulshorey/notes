/**
 * Items the user deleted from this client. An update answered 404 normally means the
 * item was deleted elsewhere, and the save creates it again so typed text is kept; for
 * an item deleted here by the user's own request it must not, since an autosave already
 * in flight would bring back the note the user just removed.
 */
const deletedByUser = new Set<number>()

export const markItemDeletedByUser = (itemId: number) => void deletedByUser.add(itemId)
export const unmarkItemDeletedByUser = (itemId: number) => void deletedByUser.delete(itemId)
export const wasItemDeletedByUser = (itemId: number) => deletedByUser.has(itemId)
