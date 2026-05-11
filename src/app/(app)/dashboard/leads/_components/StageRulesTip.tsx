'use client'
import { useEffect, useState } from 'react'

const STORAGE_KEY = 'ws_stage_rules_tip_dismissed_v1'

export function StageRulesTip({ hasUnconfiguredStage }: { hasUnconfiguredStage: boolean }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!hasUnconfiguredStage) return
    if (typeof window === 'undefined') return
    if (localStorage.getItem(STORAGE_KEY) === '1') return
    setVisible(true)
  }, [hasUnconfiguredStage])

  if (!visible) return null

  const dismiss = () => {
    try {
      localStorage.setItem(STORAGE_KEY, '1')
    } catch {}
    setVisible(false)
  }

  return (
    <div
      className="mt-4 flex items-start gap-3 rounded-xl px-4 py-3"
      style={{
        background: 'var(--lead-accent-tint)',
        border: '1px solid var(--lead-accent-rail)',
        color: 'var(--lead-ink)',
      }}
      role="status"
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="mt-[2px] shrink-0"
        style={{ color: 'var(--lead-accent)' }}
        aria-hidden
      >
        <circle cx="12" cy="12" r="10" />
        <path d="M12 8v4M12 16h.01" />
      </svg>
      <div className="flex-1 text-[13px] leading-snug">
        <div className="font-medium" style={{ color: 'var(--lead-ink)' }}>
          You decide when the AI moves leads between stages.
        </div>
        <div className="mt-0.5" style={{ color: 'var(--lead-body)' }}>
          Click the rules under any stage column to teach the AI which conversations belong there. Stages without rules will not auto-move leads.
        </div>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss tip"
        className="lead-focus shrink-0 rounded-md px-2 py-1 text-[12px]"
        style={{ color: 'var(--lead-muted)' }}
      >
        Got it
      </button>
    </div>
  )
}
