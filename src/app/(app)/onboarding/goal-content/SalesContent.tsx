'use client'

import { useActionState } from 'react'
import { saveSalesContentAction } from '../actions'
import { StepNav } from '../_components/StepNav'
import { t } from '@/lib/onboarding/i18n'
import type { OnboardingLang } from '@/lib/onboarding/types'

export function SalesContent({ lang, pageId, config }: { lang: OnboardingLang; pageId: string; config: unknown }) {
  const cfg = (config as Record<string, any>) ?? {}
  const product = cfg.product ?? {}
  const price = cfg.price ?? {}
  const [state, action, pending] = useActionState(saveSalesContentAction, {})

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="page_id" value={pageId} />
      <h2 className="text-sm font-medium text-zinc-700">{t('gc.sales.heading', lang)}</h2>

      <Labeled label={t('gc.sales.name', lang)}><input name="name" defaultValue={product.name ?? ''} required maxLength={160} className={inp} /></Labeled>
      <Labeled label={t('gc.sales.headline', lang)}><input name="headline" defaultValue={product.headline ?? ''} maxLength={240} className={inp} /></Labeled>
      <Labeled label={t('gc.sales.description', lang)}><textarea name="description" rows={4} defaultValue={product.description ?? ''} maxLength={4000} className={inp} /></Labeled>
      <Labeled label={t('gc.sales.price', lang)}><input type="number" name="price_amount" defaultValue={price.amount ?? ''} min={0} className={`${inp} w-40`} /></Labeled>

      {state.error && <p className="text-sm text-red-600">{t('goal_content.error.save', lang)}</p>}
      <StepNav step="goal_content" lang={lang} continueSlot={<SaveButton pending={pending} lang={lang} />} />
    </form>
  )
}

const inp = 'mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm'
function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="block text-sm font-medium text-zinc-900">{label}</span>{children}</label>
}
function SaveButton({ pending, lang }: { pending: boolean; lang: OnboardingLang }) {
  return (
    <button type="submit" disabled={pending} className="inline-flex items-center rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60">
      {pending ? t('goal_content.saving', lang) : t('goal_content.save', lang)}
    </button>
  )
}
