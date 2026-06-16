'use client'

import { S } from './tokens'
import type { TemplateMetaStatus } from '@/lib/messenger-templates/types'

export type StatusFilter = 'all' | TemplateMetaStatus

const ORDER: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'draft', label: 'Draft' },
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'disabled', label: 'Disabled' },
]

/**
 * Sticky segmented status pills with live counts. Replaces the buried <select>;
 * defaults to "All" so freshly-created drafts are never hidden. The heartbeat
 * appears only while the live status poll is running.
 */
export function StatusSpine({
  value,
  counts,
  onChange,
  pollingActive,
}: {
  value: StatusFilter
  counts: Record<StatusFilter, number>
  onChange: (next: StatusFilter) => void
  pollingActive: boolean
}) {
  return (
    <div
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 5,
        background: S.surface,
        paddingBottom: 10,
        marginBottom: 4,
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {ORDER.map(({ key, label }) => {
          const active = value === key
          return (
            <button
              key={key}
              onClick={() => onChange(key)}
              style={{
                border: 'none',
                background: 'transparent',
                color: active ? S.accent : S.ink3,
                fontSize: 12,
                fontWeight: active ? 600 : 400,
                padding: '4px 8px 6px',
                cursor: 'pointer',
                borderBottom: `2px solid ${active ? S.accent : 'transparent'}`,
                whiteSpace: 'nowrap',
              }}
            >
              {label}{' '}
              <span style={{ color: active ? S.accent : S.ink4, fontFamily: S.mono, fontSize: 11 }}>
                {counts[key] ?? 0}
              </span>
            </button>
          )
        })}
      </div>
      {pollingActive && (
        <div style={{ marginTop: 4, fontSize: 10.5, color: S.ink4, fontFamily: S.mono, display: 'flex', alignItems: 'center', gap: 5 }}>
          <span className="tpl-spin" aria-hidden style={{ width: 9, height: 9 }} />
          Live · auto-checking Meta
        </div>
      )}
    </div>
  )
}
