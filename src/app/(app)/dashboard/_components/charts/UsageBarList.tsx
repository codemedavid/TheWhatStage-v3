/**
 * Server-rendered horizontal bar list for a small ranked breakdown (e.g. usage
 * by scope or model). Value-proportional bars, tokens-primary, fully accessible
 * as a definition-style list. No client JS.
 */
export interface BarDatum {
  label: string
  sublabel?: string
  value: number
}

export default function UsageBarList({
  items,
  emptyLabel = 'No data in this period.',
}: {
  items: BarDatum[]
  emptyLabel?: string
}) {
  if (items.length === 0) {
    return <p className="text-sm text-neutral-400">{emptyLabel}</p>
  }
  const max = Math.max(1, ...items.map((i) => i.value))

  return (
    <ul className="space-y-2.5">
      {items.map((item, i) => {
        const pct = Math.round((item.value / max) * 100)
        return (
          <li key={i}>
            <div className="flex items-baseline justify-between gap-3 text-[13px]">
              <span className="truncate font-medium text-neutral-700">
                {item.label}
                {item.sublabel ? <span className="ml-1.5 text-neutral-400">{item.sublabel}</span> : null}
              </span>
              <span className="shrink-0 tabular-nums text-neutral-500">
                {item.value.toLocaleString('en-US')}
              </span>
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-neutral-100" aria-hidden="true">
              <div className="h-full rounded-full bg-emerald-500/70" style={{ width: `${Math.max(2, pct)}%` }} />
            </div>
          </li>
        )
      })}
    </ul>
  )
}
