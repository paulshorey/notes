export const toDateTimeLocalValue = (value: string | Date) => {
  const date = value instanceof Date ? value : new Date(value)
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return localDate.toISOString().slice(0, 16)
}
