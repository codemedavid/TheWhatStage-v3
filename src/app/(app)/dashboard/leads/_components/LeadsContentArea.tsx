'use client'
import type { ReactNode } from 'react'
import { useNavPending } from './_useUrlState'

export function LeadsContentArea({ children }: { children: ReactNode }) {
  const pending = useNavPending()
  return (
    <div className="relative mt-5">
      <div
        className="lead-progress-track"
        style={{
          opacity: pending ? 1 : 0,
          transition: 'opacity 120ms',
          marginBottom: 8,
        }}
        aria-hidden={!pending}
        role="progressbar"
        aria-busy={pending}
      >
        {pending && <div className="lead-progress-bar" />}
      </div>
      <div
        style={{
          opacity: pending ? 0.55 : 1,
          transition: 'opacity 150ms',
          pointerEvents: pending ? 'none' : 'auto',
        }}
      >
        {children}
      </div>
    </div>
  )
}
