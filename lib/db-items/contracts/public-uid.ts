import { InvalidRequestError } from "./request-error"
/**
 * The public identity of an item or a workspace: a UUID that never changes and is the
 * only id that leaves the database in a URL, a backup, or a device's storage. Integer
 * ids are internal keys.
 *
 * A client may choose the uid of an item it creates, so that sending the same create
 * twice stores one item.
 */
const PUBLIC_UID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export const INVALID_PUBLIC_UID_ERROR = "uid must be a UUID."

/** PostgreSQL prints a uuid in lowercase, so a uid is compared in that form. */
export const isPublicUid = (value: unknown): value is string =>
  typeof value === "string" && PUBLIC_UID.test(value)

/** An optional uid from a request: absent stays absent, anything else must be a UUID. */
export const parseOptionalPublicUid = (value: unknown): string | null => {
  if (value == null || value === "") return null
  const uid = typeof value === "string" ? value.trim().toLowerCase() : value
  if (!isPublicUid(uid)) throw new InvalidRequestError(INVALID_PUBLIC_UID_ERROR)
  return uid
}

/** Raised when a create names a uid that another item already has. */
export const PUBLIC_UID_TAKEN_ERROR = "An item with this uid already exists."
