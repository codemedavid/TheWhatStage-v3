'use client'

// WhatStage University — small circular progress ring (thumbnail corner).
// Emerald arc on a faint track; renders a check at 100%.

export function ProgressRing({ pct, size = 36 }: { pct: number; size?: number }) {
  const clamped = Math.max(0, Math.min(100, Math.round(pct)))
  const stroke = Math.max(3, Math.round(size * 0.1))
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const dash = (clamped / 100) * c
  const done = clamped >= 100

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={`${clamped}% complete`}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--uni-surface-3)"
        strokeWidth={stroke}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--uni-accent)"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${dash} ${c - dash}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      {done ? (
        <path
          d={`M${size * 0.32} ${size * 0.52} L${size * 0.44} ${size * 0.64} L${size * 0.68} ${size * 0.38}`}
          fill="none"
          stroke="var(--uni-accent)"
          strokeWidth={Math.max(2, stroke - 1)}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : (
        <text
          x="50%"
          y="50%"
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={size * 0.28}
          fontFamily="var(--uni-mono)"
          fill="var(--uni-accent-ink)"
        >
          {clamped}
        </text>
      )}
    </svg>
  )
}

export default ProgressRing
