'use client'

import { S } from './tokens'

/**
 * Sticky bulk-action bar shown when one or more templates are selected. The
 * submit/refresh buttons reflect the actionable subsets of the selection
 * (submittable = draft|rejected, refreshable = pending) and silently skip the
 * rest.
 */
export function SelectionBulkBar({
  selectedCount,
  submittableCount,
  refreshableCount,
  busy,
  onSubmit,
  onRefresh,
  onClear,
}: {
  selectedCount: number
  submittableCount: number
  refreshableCount: number
  busy: boolean
  onSubmit: () => void
  onRefresh: () => void
  onClear: () => void
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        flexWrap: 'wrap',
        padding: '10px 12px',
        marginBottom: 10,
        background: S.accentSoft,
        border: `1px solid ${S.accent}`,
        borderRadius: 8,
      }}
    >
      <span style={{ fontSize: 12, fontWeight: 600, color: S.accentInk }}>
        {selectedCount} selected
      </span>
      <div style={{ flex: 1 }} />
      <button
        onClick={onSubmit}
        disabled={busy || submittableCount === 0}
        title={submittableCount === 0 ? 'Only draft or rejected templates can be submitted' : undefined}
        style={{
          border: 'none',
          background: submittableCount === 0 || busy ? S.surface2 : S.accent,
          color: submittableCount === 0 || busy ? S.ink4 : '#fff',
          padding: '6px 12px',
          borderRadius: 6,
          fontSize: 12,
          fontWeight: 500,
          cursor: submittableCount === 0 || busy ? 'default' : 'pointer',
        }}
      >
        {busy ? 'Submitting…' : `Submit to Meta${submittableCount ? ` (${submittableCount})` : ''}`}
      </button>
      <button
        onClick={onRefresh}
        disabled={busy || refreshableCount === 0}
        title={refreshableCount === 0 ? 'No pending templates selected' : undefined}
        style={{
          border: `1px solid ${S.border}`,
          background: S.surface,
          color: refreshableCount === 0 || busy ? S.ink4 : S.ink2,
          padding: '6px 12px',
          borderRadius: 6,
          fontSize: 12,
          cursor: refreshableCount === 0 || busy ? 'default' : 'pointer',
        }}
      >
        Refresh pending{refreshableCount ? ` (${refreshableCount})` : ''}
      </button>
      <button
        onClick={onClear}
        disabled={busy}
        style={{ border: 'none', background: 'transparent', color: S.ink3, padding: '6px 8px', fontSize: 12, cursor: 'pointer' }}
      >
        Clear
      </button>
    </div>
  )
}
