'use client'

import type { TemplateCategory } from '@/lib/messenger-templates/types'

// Shared category chip toggle row. Used by the Templates sidebar filter, the
// Templates editor tag-picker, and the Agent's template filter so the chip
// styling stops being copy-pasted in three places.

const ACCENT = '#1F7A4D'
const ACCENT_SOFT = '#F2F8F4'
const BORDER = '#E8E6DE'
const SURFACE = '#FFFFFF'
const INK2 = '#3F3D36'

export function CategoryChips({
  categories,
  selectedIds,
  onToggle,
  size = 'sm',
}: {
  categories: TemplateCategory[]
  selectedIds: string[]
  onToggle: (id: string) => void
  size?: 'sm' | 'md'
}) {
  const padding = size === 'sm' ? '3px 9px' : '4px 10px'
  const fontSize = size === 'sm' ? 11 : 12
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {categories.map((c) => {
        const on = selectedIds.includes(c.id)
        return (
          <button
            key={c.id}
            type="button"
            onClick={() => onToggle(c.id)}
            style={{
              border: `1px solid ${on ? ACCENT : BORDER}`,
              background: on ? ACCENT_SOFT : SURFACE,
              color: on ? ACCENT : INK2,
              padding,
              borderRadius: 999,
              fontSize,
              cursor: 'pointer',
            }}
          >
            {c.label}
          </button>
        )
      })}
    </div>
  )
}
