'use client'

import { useEffect, useState } from 'react'

interface Props {
  /** Step-specific status lines that rotate every 2s. Required ≥ 1 line. */
  lines: string[]
  /** Optional heading shown above the orb. */
  heading?: string
}

export function GenerationAnimation({ lines, heading }: Props) {
  const [index, setIndex] = useState(0)

  useEffect(() => {
    if (lines.length <= 1) return
    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (prefersReducedMotion) return
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % lines.length)
    }, 2000)
    return () => clearInterval(id)
  }, [lines])

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-col items-center gap-6 py-12 text-center"
    >
      {heading ? (
        <h2 className="text-lg font-semibold text-zinc-900">{heading}</h2>
      ) : null}

      <div className="relative h-24 w-24">
        <div className="absolute inset-0 animate-[spin_8s_linear_infinite] rounded-full bg-[conic-gradient(from_0deg,#a78bfa,#22d3ee,#34d399,#a78bfa)] blur-md opacity-80 motion-reduce:animate-pulse" />
        <div className="absolute inset-2 rounded-full bg-white" />
      </div>

      <p className="min-h-[1.5rem] text-sm text-zinc-700 transition-opacity duration-500">
        {lines[index]}
      </p>

      <div className="h-1 w-48 overflow-hidden rounded-full bg-zinc-200">
        <div className="h-full w-1/3 animate-[shimmer_1.5s_ease-in-out_infinite] rounded-full bg-zinc-900/70 motion-reduce:animate-none" />
      </div>
    </div>
  )
}
