'use client'
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { TimeseriesPoint } from '@/lib/analytics/leads-analytics'

const SERIES = [
  { key: 'leads', color: '#2563eb', label: 'Leads' },
  { key: 'projects', color: '#16a34a', label: 'Projects' },
  { key: 'submissions', color: '#d97706', label: 'Submissions' },
] as const

/** Daily leads / projects / submissions, as stacked-free overlapping areas. */
export function TrendChart({ points }: { points: TimeseriesPoint[] }) {
  const data = points.map((p) => ({
    day: p.day.slice(5),
    leads: p.leads,
    projects: p.projects,
    submissions: p.submissions,
  }))

  return (
    <div style={{ width: '100%', height: 260 }}>
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
          <defs>
            {SERIES.map((s) => (
              <linearGradient key={s.key} id={`grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity={0.25} />
                <stop offset="100%" stopColor={s.color} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="day" tick={{ fontSize: 11 }} stroke="#9ca3af" />
          <YAxis allowDecimals={false} tick={{ fontSize: 11 }} stroke="#9ca3af" width={36} />
          <Tooltip />
          <Legend />
          {SERIES.map((s) => (
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={s.color}
              fill={`url(#grad-${s.key})`}
              strokeWidth={2}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
