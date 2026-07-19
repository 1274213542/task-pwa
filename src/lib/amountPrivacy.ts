/**
 * Hide only the numeric result while retaining its currency cue. This lets a
 * user distinguish JPY from CNY without exposing the balance itself.
 */
export function maskAmountText(value: string | number) {
  const text = String(value).trim()
  const firstDigit = text.search(/\d/u)
  if (firstDigit < 0) return '••••'
  const prefix = text.slice(0, firstDigit).trimEnd()
  return `${prefix}${prefix ? ' ' : ''}••••`
}
