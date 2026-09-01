export const normalizeLabel = (value: string) => value.trim().toLocaleLowerCase()

export const toLowercaseInput = (value: string) => value.toLocaleLowerCase()

/**
 * Display title for a note, derived from its first line. Shared by the results
 * list and the recent-notes dropdown; takes the raw description rather than a
 * record so an unsaved draft can use it too.
 */
export const noteHeadline = (description: string | null | undefined): string => {
  const raw = description?.trim() ?? ""
  if (raw === "") return "Untitled"

  const firstLine = (raw.split(/\r?\n/)[0] ?? "").replaceAll(/[^\w\s]/g, "").trim()
  if (firstLine === "") return "Untitled"
  if (firstLine.length <= 100) return firstLine
  return `${firstLine.slice(0, 100)}…`
}

export const firstLineLabel = (value: string) => {
  const lineBreakIndex = value.search(/[\r\n]/)
  const firstLine = lineBreakIndex === -1 ? value : value.slice(0, lineBreakIndex)
  return firstLine
    .substring(0, 100)
    .replaceAll(/[^\w\d]/g, "")
    .trim()
}
