export const normalizeLabel = (value: string) => value.trim().toLocaleLowerCase()

export const toLowercaseInput = (value: string) => value.toLocaleLowerCase()

export const firstLineLabel = (value: string) => {
  const lineBreakIndex = value.search(/[\r\n]/)
  const firstLine = lineBreakIndex === -1 ? value : value.slice(0, lineBreakIndex)
  return firstLine
    .substring(0, 100)
    .replaceAll(/[^\w\d]/g, "")
    .trim()
}
