/**
 * Server-rendered SVG trend chart — no client JS, no chart library. Draws an
 * area + line for a daily series and pairs it with a visually-hidden data table
 * for screen readers. Responsive via viewBox. Tokens-primary (no currency).
 */
export interface TrendDatum {
  label: string
  value: number
}

export default function UsageTrendChart({
  points,
  height = 160,
  ariaLabel,
}: {
  points: TrendDatum[]
  height?: number
  ariaLabel: string
}) {
  const width = 720
  const padX = 8
  const padY = 10

  if (points.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-lg border border-dashed border-neutral-200 text-sm text-neutral-400"
        style={{ height }}
      >
        No usage in this period yet.
      </div>
    )
  }

  const max = Math.max(1, ...points.map((p) => p.value))
  const n = points.length
  const innerW = width - padX * 2
  const innerH = height - padY * 2
  const x = (i: number) => padX + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW)
  const y = (v: number) => padY + innerH - (v / max) * innerH

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ')
  const areaPath =
    `M${x(0).toFixed(1)},${(height - padY).toFixed(1)} ` +
    points.map((p, i) => `L${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ') +
    ` L${x(n - 1).toFixed(1)},${(height - padY).toFixed(1)} Z`

  const peak = points.reduce((a, b) => (b.value > a.value ? b : a), points[0])

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        role="img"
        aria-label={ariaLabel}
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="usageTrendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#059669" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#059669" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill="url(#usageTrendFill)" />
        <path d={linePath} fill="none" stroke="#059669" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => (
          <circle key={i} cx={x(i)} cy={y(p.value)} r={n <= 31 ? 2 : 1.2} fill="#059669" />
        ))}
      </svg>
      <figcaption className="mt-2 flex justify-between text-[11px] text-neutral-400">
        <span>{points[0].label}</span>
        <span>peak {peak.value.toLocaleString('en-US')} · {peak.label}</span>
        <span>{points[n - 1].label}</span>
      </figcaption>
      {/* Accessible fallback for assistive tech. */}
      <table className="sr-only">
        <caption>{ariaLabel}</caption>
        <thead>
          <tr><th>Day</th><th>Tokens</th></tr>
        </thead>
        <tbody>
          {points.map((p, i) => (
            <tr key={i}><td>{p.label}</td><td>{p.value.toLocaleString('en-US')}</td></tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}
