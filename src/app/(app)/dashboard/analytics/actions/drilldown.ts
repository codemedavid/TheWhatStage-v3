'use server'

import { z } from 'zod'
import { getLeadProjectLeads, type DrilldownLead } from '@/lib/analytics/leads-analytics'

/**
 * Server action behind the cross-stage / funnel drill-downs. Returns the actual
 * leads behind a (lead rank, project rank) cell. Auth + tenant scoping live in
 * the RPC (auth.uid()), so the filter args can only ever narrow the caller's own
 * data — they're validated here for shape, not trust.
 */
const Input = z.object({
  from: z.string().nullish(),
  to: z.string().nullish(),
  source: z.string().nullish(),
  campaign: z.string().nullish(),
  workspace: z.string().uuid().nullish(),
  leadRank: z.number().int().min(0),
  projectRank: z.number().int().min(-1),
  limit: z.number().int().min(1).max(500).default(100),
})

export type DrilldownInput = z.input<typeof Input>

export interface DrilldownResult {
  ok: boolean
  leads: DrilldownLead[]
  error?: string
}

export async function fetchDrilldownLeads(raw: DrilldownInput): Promise<DrilldownResult> {
  const parsed = Input.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, leads: [], error: 'Invalid drill-down request' }
  }
  const { from, to, source, campaign, workspace, leadRank, projectRank, limit } = parsed.data
  try {
    const leads = await getLeadProjectLeads(
      { from, to, source, campaign, workspace },
      leadRank,
      projectRank,
      limit,
    )
    return { ok: true, leads }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to load leads'
    console.error('[analytics] fetchDrilldownLeads failed', error)
    return { ok: false, leads: [], error: message }
  }
}
