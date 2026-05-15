'use client'
import { useState, useTransition } from 'react'
import { setAutoClassifyAction } from '../actions/classify'

export function AutoClassifyToggle({ initial }: { initial: boolean }) {
  const [enabled, setEnabled] = useState(initial)
  const [pending, startTransition] = useTransition()

  function toggle() {
    const next = !enabled
    setEnabled(next)
    startTransition(async () => {
      try {
        await setAutoClassifyAction(next)
      } catch {
        setEnabled(!next)
      }
    })
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label="Auto-classify pipeline stage"
      title={
        enabled
          ? 'Auto-pipeline ON — bot moves leads forward based on each message'
          : 'Auto-pipeline OFF — leads stay where you put them'
      }
      onClick={toggle}
      disabled={pending}
      className="lead-focus inline-flex h-8 items-center gap-2 rounded-full px-3 text-[12.5px] font-medium transition-colors"
      style={{
        background: enabled ? 'color-mix(in oklab, var(--lead-accent) 12%, transparent)' : 'var(--lead-surface-2)',
        border: `1px solid ${enabled ? 'color-mix(in oklab, var(--lead-accent) 35%, var(--lead-line))' : 'var(--lead-line)'}`,
        color: enabled ? 'var(--lead-accent)' : 'var(--lead-muted)',
        opacity: pending ? 0.6 : 1,
        cursor: pending ? 'wait' : 'pointer',
      }}
    >
      <span
        aria-hidden
        className="relative inline-flex h-4 w-7 rounded-full transition-colors"
        style={{ background: enabled ? 'var(--lead-accent)' : 'var(--lead-line)' }}
      >
        <span
          className="absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all"
          style={{ left: enabled ? '14px' : '2px' }}
        />
      </span>
      <span>Auto-pipeline {enabled ? 'on' : 'off'}</span>
    </button>
  )
}
