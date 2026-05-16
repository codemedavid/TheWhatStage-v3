'use client'

import { useActionState, useState } from 'react'
import { saveCatalogProductsAction } from '../actions'
import { StepNav } from '../_components/StepNav'
import { t } from '@/lib/onboarding/i18n'
import type { OnboardingLang } from '@/lib/onboarding/types'

interface P { title: string; price_amount: number | null; summary: string }

export function CatalogContent({ lang }: { lang: OnboardingLang; pageId: string }) {
  const [products, setProducts] = useState<P[]>([{ title: '', price_amount: null, summary: '' }])
  const [state, action, pending] = useActionState(saveCatalogProductsAction, {})

  const payload = products
    .map((p) => ({
      title: p.title.trim(),
      price_amount: p.price_amount,
      summary: p.summary.trim() || undefined,
    }))
    .filter((p) => p.title.length > 0)

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="products_json" value={JSON.stringify(payload)} />
      <h2 className="text-sm font-medium text-zinc-700">{t('gc.catalog.heading', lang)}</h2>

      <ul className="space-y-3">
        {products.map((p, i) => (
          <li key={i} className="rounded-md border border-zinc-200 bg-white p-3">
            <div className="flex items-start justify-between gap-2">
              <input
                type="text"
                value={p.title}
                onChange={(e) => setProducts((prev) => prev.map((it, j) => (j === i ? { ...it, title: e.target.value } : it)))}
                placeholder={t('gc.product.title_ph', lang)}
                maxLength={160}
                className="w-full border-0 bg-transparent text-sm font-medium text-zinc-900 focus:outline-none"
              />
              {products.length > 1 && (
                <button
                  type="button"
                  onClick={() => setProducts((prev) => prev.filter((_, j) => j !== i))}
                  className="text-xs text-zinc-500 hover:text-red-600"
                >
                  {t('gc.product.remove', lang)}
                </button>
              )}
            </div>
            <input
              type="number"
              value={p.price_amount ?? ''}
              onChange={(e) =>
                setProducts((prev) =>
                  prev.map((it, j) => (j === i ? { ...it, price_amount: e.target.value ? Number(e.target.value) : null } : it)),
                )
              }
              placeholder={t('gc.product.price_ph', lang)}
              min={0}
              className="mt-2 block w-40 rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm"
            />
            <textarea
              value={p.summary}
              onChange={(e) => setProducts((prev) => prev.map((it, j) => (j === i ? { ...it, summary: e.target.value } : it)))}
              placeholder={t('gc.product.summary_ph', lang)}
              maxLength={280}
              rows={2}
              className="mt-2 w-full resize-y border-0 bg-transparent text-sm text-zinc-700 focus:outline-none"
            />
          </li>
        ))}
      </ul>

      {products.length < 5 && (
        <button
          type="button"
          onClick={() => setProducts((prev) => [...prev, { title: '', price_amount: null, summary: '' }])}
          className="text-sm font-medium text-emerald-700 hover:text-emerald-900"
        >
          {t('gc.catalog.add', lang)}
        </button>
      )}

      {state.error && <p className="text-sm text-red-600">{t('goal_content.error.save', lang)}</p>}

      <StepNav
        step="goal_content"
        lang={lang}
        continueSlot={
          <button type="submit" disabled={pending} className="inline-flex items-center rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60">
            {pending ? t('goal_content.saving', lang) : t('goal_content.save', lang)}
          </button>
        }
      />
    </form>
  )
}
