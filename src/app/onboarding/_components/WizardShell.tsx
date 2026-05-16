import Link from 'next/link'
import { LangToggle } from './LangToggle'
import { dismissOnboardingAction } from '../actions'
import { t } from '@/lib/onboarding/i18n'
import { STEP_ORDER } from '@/lib/onboarding/steps'
import type { OnboardingLang, OnboardingStep } from '@/lib/onboarding/types'
import './wizard-shell.css'

interface Props {
  lang: OnboardingLang
  /** Current step id, or null for terminal pages. */
  step: OnboardingStep | null
  /** Override the header meta for terminal screens. Without it, step=null
   * displays a "Welcome" label at 0%. */
  terminal?: 'welcome' | 'done'
  children: React.ReactNode
}

export function WizardShell({ lang, step, terminal, children }: Props) {
  const total = STEP_ORDER.length
  const idx = step ? STEP_ORDER.findIndex((s) => s.id === step) : -1
  const stepNumber = idx >= 0 ? idx + 1 : null
  const isDone = terminal === 'done'
  const pct = isDone ? 100 : stepNumber != null ? (stepNumber / total) * 100 : 0
  const stepNumLabel = stepNumber != null ? String(stepNumber).padStart(2, '0') : '00'
  const metaLabel = isDone
    ? lang === 'tl'
      ? 'Tapos'
      : 'Complete'
    : stepNumber != null
      ? `Step ${stepNumLabel} / ${String(total).padStart(2, '0')}`
      : lang === 'tl'
        ? 'Simula'
        : 'Welcome'

  return (
    <div className="ob-shell">
      <header className="ob-top">
        <Link href="/onboarding/welcome" className="brand" aria-label="WhatStage onboarding">
          <span className="brand-mark">W</span>
          <span>WhatStage</span>
        </Link>
        <div className="ob-top-right">
          <LangToggle lang={lang} />
          {!isDone && (
            <form action={dismissOnboardingAction}>
              <button type="submit" className="ob-top-link">
                {t('shell.skip_for_now', lang)}
              </button>
            </form>
          )}
        </div>
      </header>

      <div
        className="ob-progress-track"
        role={stepNumber != null || isDone ? 'progressbar' : undefined}
        aria-valuenow={isDone ? total : stepNumber ?? undefined}
        aria-valuemin={0}
        aria-valuemax={total}
      >
        <div className="ob-progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="ob-progress-meta">
        <span>{metaLabel}</span>
        <span>{Math.round(pct)}%</span>
      </div>

      <main className="ob-main">
        <div className="ob-canvas">{children}</div>
      </main>
    </div>
  )
}

