import type { StageRow, FieldDefRow, CampaignOption } from '../_lib/queries'
import { LeadsHeaderActions } from './LeadsHeaderActions'
import { AutoClassifyToggle } from './AutoClassifyToggle'

export function LeadsHeader({
  view, stageCount, leadCount, stages, fieldDefs, campaigns, autoClassifyEnabled,
}: {
  view: 'kanban' | 'table' | 'contact'
  stageCount: number
  leadCount: number
  stages: StageRow[]
  fieldDefs: FieldDefRow[]
  campaigns: CampaignOption[]
  autoClassifyEnabled: boolean
}) {
  return (
    <header
      className="sticky top-0 z-30 -mx-8 px-8 py-4 backdrop-blur"
      style={{
        background: 'color-mix(in oklab, var(--lead-page) 88%, transparent)',
        borderBottom: '1px solid var(--lead-line)',
      }}
    >
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-baseline gap-3">
          <h1
            className="text-[22px] font-semibold tracking-tight"
            style={{ color: 'var(--lead-ink)' }}
          >
            Leads
          </h1>
          <span
            className="text-[12px] tabular-nums"
            style={{ color: 'var(--lead-muted)' }}
          >
            {leadCount.toLocaleString()} {leadCount === 1 ? 'lead' : 'leads'}
            <span className="mx-1.5" style={{ color: 'var(--lead-faint)' }}>·</span>
            {stageCount} {stageCount === 1 ? 'stage' : 'stages'}
          </span>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <AutoClassifyToggle initial={autoClassifyEnabled} />
          <LeadsHeaderActions view={view} stages={stages} fieldDefs={fieldDefs} campaigns={campaigns} />
        </div>
      </div>
    </header>
  )
}
