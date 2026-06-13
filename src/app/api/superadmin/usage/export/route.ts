import { NextResponse, type NextRequest } from 'next/server'
import { requireSuperadmin, AdminAuthError } from '@/lib/auth/admin-guards'
import {
  getUsageByTenant,
  getUsageByScopeModel,
  manilaMonthStart,
  manilaToday,
} from '@/lib/billing/admin-usage'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DATE = /^\d{4}-\d{2}-\d{2}$/

function csvCell(v: string | number | null): string {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function toCsv(header: string[], rows: (string | number | null)[][]): string {
  return [header.join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\n')
}

/**
 * Superadmin usage export. ?from&to are Asia/Manila calendar days (default: this
 * month to today). With ?user=<id> exports that tenant's per-scope/model
 * breakdown; otherwise the fleet per-tenant ranking. Cost columns are included
 * for offline reconciliation (internal export) even though the UI hides them.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    await requireSuperadmin()
  } catch (e) {
    if (e instanceof AdminAuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    throw e
  }

  const url = new URL(req.url)
  const from = url.searchParams.get('from') || manilaMonthStart()
  const to = url.searchParams.get('to') || manilaToday()
  if (!DATE.test(from) || !DATE.test(to)) {
    return NextResponse.json({ error: 'from/to must be YYYY-MM-DD' }, { status: 400 })
  }
  const user = url.searchParams.get('user') || undefined

  let csv: string
  let filename: string

  if (user) {
    const rows = await getUsageByScopeModel(from, to, user)
    csv = toCsv(
      ['scope', 'model', 'total_tokens', 'cached_prompt_tokens', 'completion_tokens', 'cost_micros', 'event_count'],
      rows.map((r) => [r.scope, r.model, r.totalTokens, r.cachedPromptTokens, r.completionTokens, r.costMicros, r.eventCount]),
    )
    filename = `usage_${user}_${from}_${to}.csv`
  } else {
    const rows = await getUsageByTenant(from, to)
    csv = toCsv(
      ['user_id', 'email', 'full_name', 'tier', 'included_tokens', 'total_tokens', 'adj_tokens', 'effective_tokens', 'cost_micros', 'event_count', 'last_active_day'],
      rows.map((r) => [r.userId, r.email, r.fullName, r.tier, r.includedTokens, r.totalTokens, r.adjTokens, r.effectiveTokens, r.costMicros, r.eventCount, r.lastActiveDay]),
    )
    filename = `usage_fleet_${from}_${to}.csv`
  }

  return new NextResponse(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
    },
  })
}
