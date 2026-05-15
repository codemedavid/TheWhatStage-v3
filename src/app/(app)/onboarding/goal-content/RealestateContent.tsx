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
      <h2 className="text-sm font-medium text-zinc-700">{t('gc.realestate.heading', lang)}</h2>
      <Labeled label={t('gc.realestate.title', lang)}><input name="title" required maxLength={160} className={inp} /></Labeled>
      <Labeled label={t('gc.realestate.price', lang)}><input type="number" name="price_amount" min={0} className={`${inp} w-40`} /></Labeled>
      <Labeled label={t('gc.realestate.location', lang)}><input name="location" maxLength={280} className={inp} /></Labeled>
      {state.error && <p className="text-sm text-red-600">{t('goal_content.error.save', lang)}</p>}
      <StepNav step="goal_content" lang={lang} continueSlot={
        <button type="submit" disabled={pending} className="inline-flex items-center rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60">
          {pending ? t('goal_content.saving', lang) : t('goal_content.save', lang)}
        </button>
      } />
    </form>
  )
}

const inp = 'mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm'
function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="block text-sm font-medium text-zinc-900">{label}</span>{children}</label>
}
