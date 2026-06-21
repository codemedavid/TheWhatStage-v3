'use client'

import { conversionPct, toCsv, type CrosstabCell } from '@/lib/analytics/metrics'

interface ExportButtonProps {
  cells: CrosstabCell[]
  rangeLabel: string
}

/** Download the lead→project cross-tab as a CSV the user can open in a spreadsheet. */
export function ExportButton({ cells, rangeLabel }: ExportButtonProps) {
  const handleExport = () => {
    const headers = [
      'Lead stage',
      'Project stage',
      'Leads at lead stage',
      'Reached project stage',
      'Conversion %',
    ]
    const rows = cells.map((c) => [
      c.leadStageName,
      c.projectStageName,
      c.leadStageTotal,
      c.leads,
      conversionPct(c.leads, c.leadStageTotal).toFixed(1),
    ])
    const csv = toCsv(headers, rows)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const safeRange = rangeLabel.replace(/[^a-z0-9]+/gi, '-').toLowerCase()
    const link = document.createElement('a')
    link.href = url
    link.download = `analytics-lead-to-project-${safeRange}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  return (
    <button
      type="button"
      onClick={handleExport}
      disabled={cells.length === 0}
      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 text-[12px] font-medium text-neutral-700 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span aria-hidden>↓</span> Export CSV
    </button>
  )
}
