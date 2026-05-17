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
      <h2 className="ob-label">{t('gc.catalog.heading', lang)}</h2>

      <ul className="space-y-3">
        {products.map((p, i) => (
          <li key={i} className="ob-card">
            <div className="flex items-start justify-between gap-2">
              <input
                type="text"
                value={p.title}
                onChange={(e) => setProducts((prev) => prev.map((it, j) => (j === i ? { ...it, title: e.target.value } : it)))}
                placeholder={t('gc.product.title_ph', lang)}
                maxLength={160}
                className="ob-input"
              />
              {products.length > 1 && (
                <button
                  type="button"
                  onClick={() => setProducts((prev) => prev.filter((_, j) => j !== i))}
                  className="ob-btn ob-btn-text"
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
              inputMode="numeric"
              className="ob-input mt-2 w-40"
            />
            <textarea
              value={p.summary}
              onChange={(e) => setProducts((prev) => prev.map((it, j) => (j === i ? { ...it, summary: e.target.value } : it)))}
              placeholder={t('gc.product.summary_ph', lang)}
              maxLength={280}
              rows={2}
              className="ob-textarea mt-2"
            />
          </li>
        ))}
      </ul>

      {products.length < 5 && (
        <button
          type="button"
          onClick={() => setProducts((prev) => [...prev, { title: '', price_amount: null, summary: '' }])}
          className="ob-btn ob-btn-text"
        >
          {t('gc.catalog.add', lang)}
        </button>
      )}

      {state.error && <p className="text-sm text-red-600">{t('goal_content.error.save', lang)}</p>}

      <StepNav
        step="goal_content"
        lang={lang}
        continueSlot={
          <button type="submit" disabled={pending} className="ob-btn ob-btn-primary">
            {pending ? t('goal_content.saving', lang) : t('goal_content.save', lang)}
          </button>
        }
      />
    </form>
  )
}
