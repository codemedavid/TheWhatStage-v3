export interface AddressInput {
  line1?: string | null
  line2?: string | null
  city?: string | null
  region?: string | null
  postal?: string | null
  country?: string | null
}

export function joinAddress(addr: AddressInput | null | undefined): string {
  if (!addr) return ''
  return [addr.line1, addr.line2, addr.city, addr.region, addr.postal, addr.country]
    .map((p) => (p ?? '').trim())
    .filter((p) => p.length > 0)
    .join(', ')
}

export function buildMapEmbedUrl(
  addr: AddressInput | null | undefined,
): string | null {
  const joined = joinAddress(addr)
  if (!joined) return null
  return `https://www.google.com/maps?q=${encodeURIComponent(joined)}&output=embed`
}
