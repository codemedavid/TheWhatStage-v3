'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import type { GenerationKind } from '@/lib/onboarding/generation/types'
import { GenerationAnimation } from './GenerationAnimation'
import { t, type DictKey } from '@/lib/onboarding/i18n'
import type { OnboardingLang } from '@/lib/onboarding/types'

interface Props {
  kind: GenerationKind
  animationLines: string[]
  animationHeading: string
  errorMessage?: string
  skipHref: string
  skipLabel: string
  lang: OnboardingLang
}

const FAILURE_KEYS: Record<string, DictKey> = {
  timeout: 'generation.failure.timeout',
  not_enqueued: 'generation.failure.not_enqueued',
  unknown_error: 'generation.failure.unknown_error',
}

function failureLabel(reason: string, lang: OnboardingLang): string {
  const key = FAILURE_KEYS[reason]
  return key ? t(key, lang) : reason
}

type PollState =
  | { phase: 'polling' }
  | { phase: 'failed'; error: string }

// Hard ceiling so a stuck job never traps the user. Generators have a 60s
// server-side timeout; double it for client patience plus a margin.
const MAX_POLL_MS = 120_000
// After this many ticks of 404 (job missing), assume lazy-enqueue failed and
// surface a retry CTA instead of polling forever.
const NOT_ENQUEUED_TICK_GIVEUP = 6

function computeDelay(tick: number): number {
  if (tick < 4) return 1500            // fast first ~6s
  if (tick < 10) return 3000           // mid window
  return Math.min(8000, 1500 * Math.log2(tick + 1))
}

export function GenerationGate({
  kind,
  animationLines,
  animationHeading,
  errorMessage,
  skipHref,
  skipLabel,
  lang,
}: Props) {
  const router = useRouter()
  const [state, setState] = useState<PollState>({ phase: 'polling' })
  const cancelled = useRef(false)

  useEffect(() => {
    cancelled.current = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let tickCount = 0
    let notFoundTicks = 0
    const startedAt = Date.now()

    const schedule = (ms: number) => {
      timer = setTimeout(tick, ms)
    }

    const tick = async () => {
      if (cancelled.current) return
      // Pause while the tab is hidden — saves the user's data plan and our
      // Supabase auth.getUser quota on backgrounded mobile sessions. We
      // resume on visibilitychange below.
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        schedule(4000)
        return
      }
      if (Date.now() - startedAt > MAX_POLL_MS) {
        setState({ phase: 'failed', error: 'timeout' })
        return
      }
      try {
        const res = await fetch(`/api/onboarding/generation/${kind}`, {
          cache: 'no-store',
        })
        if (res.ok) {
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
          notFoundTicks = 0
        } else if (res.status === 404) {
          notFoundTicks += 1
          if (notFoundTicks >= NOT_ENQUEUED_TICK_GIVEUP) {
            setState({ phase: 'failed', error: 'not_enqueued' })
            return
          }
        }
      } catch {
        // network blip — keep polling
      }
      tickCount += 1
      schedule(computeDelay(tickCount))
    }

    tick()

    const onVis = () => {
      if (typeof document === 'undefined') return
      if (document.visibilityState === 'visible' && !cancelled.current) {
        if (timer) clearTimeout(timer)
        tick()
      }
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVis)
    }
    return () => {
      cancelled.current = true
      if (timer) clearTimeout(timer)
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVis)
      }
    }
  }, [kind, router])

  if (state.phase === 'failed') {
    return (
      <div className="mt-6 rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-900">
        <p>{errorMessage ?? 'Generation failed.'}</p>
        <p className="mt-2 text-xs text-red-800/80">{failureLabel(state.error, lang)}</p>
        <div className="mt-3 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => {
              setState({ phase: 'polling' })
              router.refresh()
            }}
            className="font-medium underline"
          >
            {t('generation.retry', lang)}
          </button>
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
