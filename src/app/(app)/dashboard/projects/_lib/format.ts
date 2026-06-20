// Currency formatting shared by the board (client) and the stats strip
// (server). Lives in _lib so it carries no "use client" boundary and is safe to
// call from a server component.
export function formatMoney(value: number | null, currency: string): string {
  if (value == null) return ''
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format(value)
  } catch {
    return `${currency} ${value.toLocaleString()}`
  }
}
