import UsageTrendChart from './charts/UsageTrendChart'
import UsageBarList, { type BarDatum } from './charts/UsageBarList'
import type { UsageTotals, UsageTrendPoint, ScopeModelRow } from '@/lib/billing/admin-usage'

// Friendly labels for the usage scopes (the raw enum is developer-facing).
const SCOPE_LABEL: Record<string, string> = {
  'chatbot.answer': 'Reply',
  'chatbot.classify': 'Reply + classify',
  'chatbot.answer.fallback': 'Reply (fallback)',
  'chatbot.summary': 'Summary',
  'comment.classify': 'Comment moderation',
  'deep.reclassify': 'Deep reclassify',
  'embed.query': 'Embedding (query)',
  'embed.batch': 'Embedding (batch)',
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4">
      <div className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="mt-1 text-[22px] font-semibold tabular-nums text-neutral-900">{value}</div>
      {hint ? <div className="mt-0.5 text-[12px] text-neutral-400">{hint}</div> : null}
    </div>
  )
}

/**
 * Reusable usage analytics block (KPI cards + SSR trend + scope/model
 * breakdowns). Tokens-primary; cost is deliberately not shown until provider
 * rates are verified. Used for the whole fleet and for a single tenant.
 */
export default function UsageAnalyticsPanel({
  totals,
  trend,
  scopeModel,
  periodLabel,
  isFleet = false,
}: {
  totals: UsageTotals
  trend: UsageTrendPoint[]
  scopeModel: ScopeModelRow[]
  periodLabel: string
  isFleet?: boolean
}) {
  const trendPoints = trend.map((p) => ({ label: p.day.slice(5), value: p.totalTokens }))
  const cachePct =
    totals.promptTokens > 0 ? Math.round((totals.cachedPromptTokens / totals.promptTokens) * 100) : 0

  const byScope = new Map<string, number>()
  const byModel = new Map<string, number>()
  for (const r of scopeModel) {
    byScope.set(r.scope, (byScope.get(r.scope) ?? 0) + r.totalTokens)
    byModel.set(r.model, (byModel.get(r.model) ?? 0) + r.totalTokens)
  }
  const scopeBars: BarDatum[] = [...byScope.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([scope, value]) => ({ label: SCOPE_LABEL[scope] ?? scope, value }))
  const modelBars: BarDatum[] = [...byModel.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([model, value]) => ({ label: model.split('/').pop() ?? model, sublabel: '', value }))

  return (
    <div className="space-y-5">
      <div className={`grid gap-3 ${isFleet ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-2 sm:grid-cols-3'}`}>
        {isFleet && <Kpi label="Active tenants" value={totals.activeTenants.toLocaleString('en-US')} />}
        <Kpi label="Tokens" value={totals.totalTokens.toLocaleString('en-US')} hint={periodLabel} />
        <Kpi
          label="Cache hits"
          value={totals.cachedPromptTokens.toLocaleString('en-US')}
          hint={`${cachePct}% of prompt tokens served from cache`}
        />
        <Kpi label="Model calls" value={totals.eventCount.toLocaleString('en-US')} />
      </div>

      <div className="rounded-xl border border-neutral-200 bg-white p-5">
        <div className="mb-3 flex items-baseline justify-between">
          <h3 className="text-[14px] font-semibold text-neutral-900">Token usage trend</h3>
          <span className="text-[12px] text-neutral-400">updated hourly</span>
        </div>
        <UsageTrendChart
          points={trendPoints}
          ariaLabel={`Daily token usage for ${periodLabel}`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-neutral-200 bg-white p-5">
          <h3 className="mb-3 text-[14px] font-semibold text-neutral-900">By workload</h3>
          <UsageBarList items={scopeBars} />
        </div>
        <div className="rounded-xl border border-neutral-200 bg-white p-5">
          <h3 className="mb-3 text-[14px] font-semibold text-neutral-900">By model</h3>
          <UsageBarList items={modelBars} />
        </div>
      </div>
    </div>
  )
}
