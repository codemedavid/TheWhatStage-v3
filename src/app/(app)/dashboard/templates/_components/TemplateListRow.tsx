'use client'

import { S } from './tokens'
import { templateStatusBadge } from '@/lib/messenger-templates/statusBadge'
import type { MessengerMessageTemplateWithCategories } from '@/lib/messenger-templates/types'

/**
 * A single row in the template list: selection checkbox + name + status badge,
 * with a live spinner while pending, the rejection reason inline when rejected,
 * and a "Use in Agent →" deep link when approved.
 */
export function TemplateListRow({
  template,
  isOpen,
  isSelected,
  isPolling,
  onOpen,
  onToggleSelect,
}: {
  template: MessengerMessageTemplateWithCategories
  isOpen: boolean
  isSelected: boolean
  isPolling: boolean
  onOpen: () => void
  onToggleSelect: () => void
}) {
  const badge = templateStatusBadge(template.meta_status)
  const pending = template.meta_status === 'pending'
  const rejected = template.meta_status === 'rejected'
  const approved = template.meta_status === 'approved'

  return (
    <li
      style={{
        display: 'flex',
        gap: 8,
        padding: '10px 10px',
        marginBottom: 4,
        borderRadius: 8,
        background: isOpen ? S.accentSoft : 'transparent',
        border: `1px solid ${isOpen ? S.accent : 'transparent'}`,
      }}
    >
      <input
        type="checkbox"
        checked={isSelected}
        onChange={(e) => { e.stopPropagation(); onToggleSelect() }}
        onClick={(e) => e.stopPropagation()}
        aria-label={`Select ${template.display_name}`}
        style={{ marginTop: 3, width: 15, height: 15, accentColor: S.accent, cursor: 'pointer', flexShrink: 0 }}
      />
      <div
        onClick={onOpen}
        style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}
      >
        <div style={{ fontSize: 13, fontWeight: 500, color: S.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {template.display_name}
        </div>
        <div style={{ fontSize: 11, color: S.ink3, fontFamily: S.mono, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {template.name}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              fontSize: 10,
              background: badge.bg,
              color: badge.color,
              padding: '2px 7px',
              borderRadius: 4,
            }}
          >
            {pending && isPolling && <span className="tpl-spin" aria-hidden style={{ width: 8, height: 8, borderColor: badge.color, borderTopColor: 'transparent' }} />}
            {badge.label}
          </span>
          {approved && (
            <a
              href={`/dashboard/agent?template=${template.id}&mode=shared_template`}
              onClick={(e) => e.stopPropagation()}
              style={{ fontSize: 10.5, color: S.accent, textDecoration: 'none', fontWeight: 500 }}
            >
              Use in Agent →
            </a>
          )}
        </div>
        {rejected && template.meta_rejection_reason && (
          <div
            title={template.meta_rejection_reason}
            style={{ fontSize: 11, color: S.danger, marginTop: 5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontStyle: 'italic' }}
          >
            {template.meta_rejection_reason}
          </div>
        )}
      </div>
    </li>
  )
}
