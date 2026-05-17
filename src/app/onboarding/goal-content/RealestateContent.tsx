'use client'

import { useActionState } from 'react'
import { saveRealestatePropertyAction } from '../actions'
import { StepNav } from '../_components/StepNav'
import { t } from '@/lib/onboarding/i18n'
import type { OnboardingLang } from '@/lib/onboarding/types'

export function RealestateContent({ lang }: { lang: OnboardingLang; pageId: string }) {
  const [state, action, pending] = useActionState(saveRealestatePropertyAction, {})
  return (
    <form action={action} className="space-y-4">
      <h2 className="ob-label">{t('gc.realestate.heading', lang)}</h2>
      <Labeled label={t('gc.realestate.title', lang)}><input name="title" required maxLength={160} className="ob-input" /></Labeled>
      <Labeled label={t('gc.realestate.price', lang)}><input type="number" name="price_amount" min={0} className="ob-input w-40" /></Labeled>
      <Labeled label={t('gc.realestate.location', lang)}><input name="location" maxLength={280} className="ob-input" /></Labeled>
      {state.error && <p className="text-sm text-red-600">{t('goal_content.error.save', lang)}</p>}
      <StepNav step="goal_content" lang={lang} continueSlot={
        <button type="submit" disabled={pending} className="ob-btn ob-btn-primary">
          {pending ? t('goal_content.saving', lang) : t('goal_content.save', lang)}
        </button>
      } />
    </form>
  )
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="ob-field"><span className="ob-label">{label}</span>{children}</label>
}
