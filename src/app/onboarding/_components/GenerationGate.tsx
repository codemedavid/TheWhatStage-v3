'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import type { GenerationKind } from '@/lib/onboarding/generation/types'
import { GenerationAnimation } from './GenerationAnimation'

interface Props {
  kind: GenerationKind
  animationLines: string[]
  animationHeading: string
  errorMessage?: string
  skipHref: string
  skipLabel: string
}

type PollState =
  | { phase: 'polling' }
  | { phase: 'failed'; error: string }

export function GenerationGate({
  kind,
  animationLines,
  animationHeading,
  errorMessage,
  skipHref,
  skipLabel,
}: Props) {
  const router = useRouter()
  const [state, setState] = useState<PollState>({ phase: 'polling' })
  const elapsedRef = useRef(0)
  const cancelled = useRef(false)

  useEffect(() => {
    cancelled.current = false
    let timer: ReturnType<typeof setTimeout>

    const tick = async () => {
      if (cancelled.current) return
      try {
        const res = await fetch(`/api/onboarding/generation/${kind}`, {
          cache: 'no-store',
        })
        if (res.status === 404) {
          // Job not enqueued yet — keep polling.
        } else if (res.ok) {
          const body = (await res.json()) as {
            status: 'queued' | 'running' | 'done' | 'failed'
            error?: string
          }
          if (body.status === 'done') {
            router.refresh()
            return
          }
          if (body.status === 'failed') {
            setState({ phase: 'failed', error: body.error ?? 'unknown_error' })
            return
          }
        }
      } catch {
        // network blip — keep polling
      }
      elapsedRef.current += 1
      const delay = elapsedRef.current < 7 ? 1500 : 5000
      timer = setTimeout(tick, delay)
    }

    tick()
    return () => {
      cancelled.current = true
      if (timer) clearTimeout(timer)
    }
  }, [kind, router])

  if (state.phase === 'failed') {
    return (
      <div className="mt-6 rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-900">
        <p>{errorMessage ?? 'Generation failed.'}</p>
        <p className="mt-2 text-xs text-red-800/80">{state.error}</p>
        <div className="mt-3">
          <Link href={skipHref} className="font-medium underline">
            {skipLabel}
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div>
      <GenerationAnimation lines={animationLines} heading={animationHeading} />
      <div className="mt-2 text-center">
        <Link href={skipHref} className="text-sm text-zinc-600 underline">
          {skipLabel}
        </Link>
      </div>
    </div>
  )
}
