import { createAdminClient } from '@/lib/supabase/admin'
import type { PaymentMethodKind } from './types'

export interface PublicPaymentMethod {
  id: string
  kind: PaymentMethodKind
  name: string
  instructions: string | null
  account_name: string | null
  account_number: string | null
  bank_name: string | null
  branch: string | null
  qr_image_url: string | null
}

interface Row {
  id: string
  kind: PaymentMethodKind
  name: string
  instructions: string | null
  details: Record<string, string | null | undefined>
  enabled: boolean
}

function pick(d: Row['details'], key: string): string | null {
  const v = d?.[key]
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t.length > 0 ? t : null
}

/**
 * Load enabled payment methods by id, preserving the order of `ids`. Used at
 * SSR time on public action pages to render checkout payment options.
 */
export async function loadPublicPaymentMethods(
  userId: string,
  ids: string[],
): Promise<PublicPaymentMethod[]> {
  if (!ids.length) return []
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('payment_methods')
    .select('id, kind, name, instructions, details, enabled')
    .eq('user_id', userId)
    .eq('enabled', true)
    .in('id', ids)
  if (error || !data) return []
  const byId = new Map<string, Row>()
  for (const r of data as Row[]) byId.set(r.id, r)
  const out: PublicPaymentMethod[] = []
  for (const id of ids) {
    const r = byId.get(id)
    if (!r) continue
    out.push({
      id: r.id,
      kind: r.kind,
      name: r.name,
      instructions: r.instructions,
      account_name: pick(r.details, 'account_name'),
      account_number: pick(r.details, 'account_number'),
      bank_name: pick(r.details, 'bank_name'),
      branch: pick(r.details, 'branch'),
      qr_image_url: pick(r.details, 'qr_image_url'),
    })
  }
  return out
}

export function filterAllowedIds(allIds: string[], excluded: string[]): string[] {
  const set = new Set(excluded)
  return allIds.filter((id) => !set.has(id))
}

/**
 * Load all enabled payment methods for a user, minus excluded ids.
 * Used at SSR time on sales/catalog action pages when the page-level
 * payment block has no explicit include list.
 */
export async function loadEnabledPaymentMethodsForPage(
  userId: string,
  excluded: string[],
): Promise<PublicPaymentMethod[]> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('payment_methods')
    .select('id, kind, name, instructions, details, enabled, position')
    .eq('user_id', userId)
    .eq('enabled', true)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })
  if (error || !data) return []
  const set = new Set(excluded)
  const out: PublicPaymentMethod[] = []
  for (const r of data as (Row & { position: number })[]) {
    if (set.has(r.id)) continue
    out.push({
      id: r.id,
      kind: r.kind,
      name: r.name,
      instructions: r.instructions,
      account_name: pick(r.details, 'account_name'),
      account_number: pick(r.details, 'account_number'),
      bank_name: pick(r.details, 'bank_name'),
      branch: pick(r.details, 'branch'),
      qr_image_url: pick(r.details, 'qr_image_url'),
    })
  }
  return out
}
