import type { createAdminClient } from '@/lib/supabase/admin'
import type { ActionPageKind } from './kinds'

export type PipelineStageKind =
  | 'entry'
  | 'qualifying'
  | 'nurture'
  | 'decision'
  | 'won'
  | 'lost'
  | 'dormant'

const DEFAULT_STAGE_BY_KIND_AND_OUTCOME: Partial<
  Record<ActionPageKind, Record<string, PipelineStageKind>>
> = {
  form: { submitted: 'qualifying' },
  booking: { booked: 'decision' },
  qualification: {
    qualified: 'qualifying',
    disqualified: 'lost',
  },
  sales: {
    submitted: 'qualifying',
  },
  catalog: { checked_out: 'won' },
  realestate: {
    inquiry_submitted: 'qualifying',
    viewing_booked: 'decision',
  },
}

export function getDefaultStageKind(
  pageKind: ActionPageKind,
  outcome: string,
): PipelineStageKind | null {
  return DEFAULT_STAGE_BY_KIND_AND_OUTCOME[pageKind]?.[outcome] ?? null
}

export async function resolveDefaultStageId(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  kind: PipelineStageKind,
): Promise<string | null> {
  const { data, error } = await admin
    .from('pipeline_stages')
    .select('id')
    .eq('user_id', userId)
    .eq('kind', kind)
    .order('position', { ascending: true })
    .limit(1)
    .maybeSingle<{ id: string }>()

  if (error) {
    console.warn('[action-pages.default-stage] lookup failed', {
      userId,
      kind,
      err: error.message,
    })
    return null
  }

  return data?.id ?? null
}
