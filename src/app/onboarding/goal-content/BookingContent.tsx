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
      <h2 className="text-sm font-medium text-zinc-700">{t('gc.booking.heading', lang)}</h2>
      <label className="block">
        <span className="block text-sm font-medium text-zinc-900">{t('gc.booking.duration', lang)}</span>
        <input type="number" name="duration_min" defaultValue={duration} min={5} max={480} className="mt-1 block w-40 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm" />
      </label>
      <p className="text-xs text-zinc-500">{t('gc.booking.note', lang)}</p>
      {state.error && <p className="text-sm text-red-600">{t('goal_content.error.save', lang)}</p>}
      <StepNav step="goal_content" lang={lang} continueSlot={
        <button type="submit" disabled={pending} className="inline-flex items-center rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60">
          {pending ? t('goal_content.saving', lang) : t('goal_content.save', lang)}
        </button>
      } />
    </form>
  )
}
