import { LangToggle } from './LangToggle'
import { dismissOnboardingAction } from '../actions'
import { t } from '@/lib/onboarding/i18n'
import { STEP_ORDER } from '@/lib/onboarding/steps'
import type { OnboardingLang, OnboardingStep } from '@/lib/onboarding/types'

interface Props {
  lang: OnboardingLang
  /** Current step id, or null for welcome/done pages. */
  step: OnboardingStep | null
  children: React.ReactNode
}

export function WizardShell({ lang, step, children }: Props) {
  const total = STEP_ORDER.length
  const idx = step ? STEP_ORDER.findIndex((s) => s.id === step) : -1
  const stepNumber = idx >= 0 ? idx + 1 : null

  return (
    <div className="min-h-svh bg-zinc-50">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-zinc-200 bg-white px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-zinc-900">WhatStage</span>
          {stepNumber != null ? (
            <span className="text-xs text-zinc-500">
              {t('shell.progress', lang, { n: stepNumber, total })}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-3">
          <LangToggle lang={lang} />
          <form action={dismissOnboardingAction}>
            <button
              type="submit"
              className="text-xs text-zinc-600 hover:text-zinc-900"
            >
              {t('shell.skip_for_now', lang)}
            </button>
          </form>
        </div>
      </header>

      {stepNumber != null ? (
        <div
          className="h-1 w-full bg-zinc-200"
          role="progressbar"
          aria-valuenow={stepNumber}
          aria-valuemin={0}
          aria-valuemax={total}
        >
          <div
            className="h-full bg-emerald-600 transition-all"
            style={{ width: `${(stepNumber / total) * 100}%` }}
          />
        </div>
      ) : null}

      <main className="mx-auto max-w-2xl px-4 py-10">{children}</main>
    </div>
  )
}
