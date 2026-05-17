'use client'

import { useActionState } from 'react'
import { saveBookingContentAction } from '../actions'
import { StepNav } from '../_components/StepNav'
import { t } from '@/lib/onboarding/i18n'
import type { OnboardingLang } from '@/lib/onboarding/types'

export function BookingContent({ lang, pageId, config }: { lang: OnboardingLang; pageId: string; config: unknown }) {
  const cfg = (config as Record<string, any>) ?? {}
  const duration = cfg.appointment?.duration_min ?? 30
  const [state, action, pending] = useActionState(saveBookingContentAction, {})

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="page_id" value={pageId} />
      <h2 className="ob-label">{t('gc.booking.heading', lang)}</h2>
      <label className="ob-field">
        <span className="ob-label">{t('gc.booking.duration', lang)}</span>
        <input type="number" name="duration_min" defaultValue={duration} min={5} max={480} className="ob-input w-40" />
      </label>
      <p className="ob-help">{t('gc.booking.note', lang)}</p>
      {state.error && <p className="text-sm text-red-600">{t('goal_content.error.save', lang)}</p>}
      <StepNav step="goal_content" lang={lang} continueSlot={
        <button type="submit" disabled={pending} className="ob-btn ob-btn-primary">
          {pending ? t('goal_content.saving', lang) : t('goal_content.save', lang)}
        </button>
      } />
    </form>
  )
}
