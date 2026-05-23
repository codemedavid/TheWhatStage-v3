'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import type { GenerationKind } from '@/lib/onboarding/generation/types'
import { GenerationAnimation } from './GenerationAnimation'
import { t, type DictKey } from '@/lib/onboarding/i18n'
import type { OnboardingLang, OnboardingStep } from '@/lib/onboarding/types'
import { skipStepAction } from '../actions'

interface Props {
  kind: GenerationKind
  animationLines: string[]
  animationHeading: string
  errorMessage?: string
  /** @deprecated kept for backward-compat; skip now routes through skipStepAction */
  skipHref?: string
  skipLabel: string
  lang: OnboardingLang
}

/**
 * Each generation kind belongs to exactly one onboarding step. Skip must
 * route through `skipStepAction(<step>)` so the step's `*_completed_at`
 * column is set (audit-trailed via the markStep RPC) and the dashboard
 * progress stays consistent — a bare <Link> bypasses that and leaves the
 * step NULL forever.
 */
const STEP_BY_KIND: Record<GenerationKind, OnboardingStep> = {
  knowledge: 'knowledge',
  faqs: 'faqs',
  personality_seed: 'personality',
  form_fields: 'goal_content',
  bot_instructions: 'flow',
}

export function stepForGenerationKind(kind: GenerationKind): OnboardingStep {
  return STEP_BY_KIND[kind]
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
// after() callbacks fire after the HTTP response is sent, and the Supabase
// RPC that inserts the job row adds ~50-500ms (more on cold starts). The
// client must not give up on 404s before the row has had time to appear.
// 10 ticks × 1.5 s = 15 s of grace before the first delayed tick at 3 s,
// giving ~17 s total — enough for even a cold-start + slow Supabase round.
const NOT_ENQUEUED_TICK_GIVEUP = 10
// Delay before the very first poll so the server-side after() callback has
// time to enqueue the job before we start accumulating 404 ticks.
const INITIAL_POLL_DELAY_MS = 2500

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
  skipLabel,
  lang,
}: Props) {
  const step = stepForGenerationKind(kind)
  const skipAction = skipStepAction.bind(null, step)
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

    schedule(INITIAL_POLL_DELAY_MS)

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
    // Both controls live in ONE <form action={skipAction}>. The retry button
    // is type="button" so its onClick fires WITHOUT submitting; the skip
    // button is the form's natural type="submit". The previous structure put
    // the skip <form> as a sibling inside a flex container — in practice the
    // surrounding flex layout + React server-action binding combination made
    // the skip-form's submit unreliable (only form.requestSubmit() fired it).
    // Collapsing to a single form removes the ambiguity.
    return (
      <div className="mt-6 rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-900">
        <p>{errorMessage ?? 'Generation failed.'}</p>
        <p className="mt-2 text-xs text-red-800/80">{failureLabel(state.error, lang)}</p>
        <form action={skipAction} className="mt-3 flex flex-wrap gap-3">
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
          <button type="submit" className="font-medium underline">
            {skipLabel}
          </button>
        </form>
      </div>
    )
  }

  return (
    <div>
      <GenerationAnimation lines={animationLines} heading={animationHeading} />
      <div className="mt-2 text-center">
        <form action={skipAction}>
          <button type="submit" className="text-sm text-zinc-600 underline">
            {skipLabel}
          </button>
        </form>
      </div>
    </div>
  )
}
