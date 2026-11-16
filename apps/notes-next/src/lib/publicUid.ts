/**
 * A new public uid for an item this browser is about to create. The create carries it,
 * so sending that create twice stores one item.
 *
 * `crypto.randomUUID` exists only on secure origins. The app is also opened over plain
 * HTTP on a private network during development, where `getRandomValues` still works.
 */
export const newPublicUid = (): string => {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
