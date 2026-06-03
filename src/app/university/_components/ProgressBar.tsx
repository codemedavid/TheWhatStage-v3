'use client'

// WhatStage University — linear progress bar. Uses the .uni-progress > span
// gradient (emerald) from globals.css. Always announces value for a11y.

export function ProgressBar({
  pct,
  label,
  small = false,
}: {
  pct: number
  label?: string
  small?: boolean
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(pct)))
  return (
    <div
      className={small ? 'uni-progress uni-progress-sm' : 'uni-progress'}
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label ?? 'Course progress'}
    >
      <span style={{ width: `${clamped}%` }} />
    </div>
  )
}

export default ProgressBar
