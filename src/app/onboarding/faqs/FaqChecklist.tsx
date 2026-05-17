'use client'

import { useActionState, useState } from 'react'
import { saveFaqsAction } from '../actions'
import { StepNav } from '../_components/StepNav'
import { t } from '@/lib/onboarding/i18n'
import type { OnboardingLang } from '@/lib/onboarding/types'

interface FaqItem {
  question: string
  answer: string
}

interface Props {
  lang: OnboardingLang
  suggestions: FaqItem[]
}

export function FaqChecklist({ lang, suggestions }: Props) {
  const [checked, setChecked] = useState<boolean[]>(() => suggestions.map(() => true))
  const [editable, setEditable] = useState<FaqItem[]>(suggestions)
  const [custom, setCustom] = useState<FaqItem[]>([])
  const [state, action, pending] = useActionState(saveFaqsAction, {})

  const selectedSuggestions = editable.filter((_, i) => checked[i])
  const items = [...selectedSuggestions, ...custom].filter(
    (it) => it.question.trim() && it.answer.trim(),
  )

  function patchSuggestion(idx: number, patch: Partial<FaqItem>) {
    setEditable((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)))
  }
  function patchCustom(idx: number, patch: Partial<FaqItem>) {
    setCustom((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)))
  }
  function removeCustom(idx: number) {
    setCustom((prev) => prev.filter((_, i) => i !== idx))
  }

  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="items_json" value={JSON.stringify(items)} />

      <section>
        <h2 className="ob-label">{t('faqs.suggestion_label', lang)}</h2>
        <ul className="mt-2 space-y-2">
          {editable.map((item, i) => (
            <li key={i} className="ob-card">
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={checked[i]}
                  onChange={(e) =>
                    setChecked((prev) => prev.map((c, j) => (j === i ? e.target.checked : c)))
                  }
                  className="mt-1 h-4 w-4 rounded border-zinc-300 accent-[var(--accent)]"
                />
                <div className="flex-1 space-y-2">
                  <input
                    type="text"
                    value={item.question}
                    onChange={(e) => patchSuggestion(i, { question: e.target.value })}
                    maxLength={300}
                    disabled={!checked[i]}
                    className="ob-input"
                  />
                  <textarea
                    value={item.answer}
                    onChange={(e) => patchSuggestion(i, { answer: e.target.value })}
                    rows={2}
                    maxLength={4000}
                    disabled={!checked[i]}
                    className="ob-textarea"
                  />
                </div>
              </label>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="ob-label">{t('faqs.custom_label', lang)}</h2>
        <ul className="mt-2 space-y-2">
          {custom.map((item, i) => (
            <li key={i} className="ob-card">
              <div className="flex items-start justify-between gap-2">
                <input
                  type="text"
                  value={item.question}
                  onChange={(e) => patchCustom(i, { question: e.target.value })}
                  maxLength={300}
                  placeholder={t('faqs.question_ph', lang)}
                  className="ob-input"
                />
                <button
                  type="button"
                  onClick={() => removeCustom(i)}
                  className="ob-btn ob-btn-text"
                >
                  {t('faqs.remove', lang)}
                </button>
              </div>
              <textarea
                value={item.answer}
                onChange={(e) => patchCustom(i, { answer: e.target.value })}
                rows={2}
                maxLength={4000}
                placeholder={t('faqs.answer_ph', lang)}
                className="ob-textarea mt-2"
              />
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => setCustom((prev) => [...prev, { question: '', answer: '' }])}
          className="ob-btn ob-btn-text mt-2"
        >
          {t('faqs.add', lang)}
        </button>
      </section>

      {state.error && <p className="text-sm text-red-600">{t('faqs.error', lang)}</p>}

      <StepNav
        step="faqs"
        lang={lang}
        continueSlot={
          <button
            type="submit"
            disabled={pending}
            className="ob-btn ob-btn-primary"
          >
            {pending ? t('faqs.saving', lang) : t('faqs.save', lang)}
          </button>
        }
      />
    </form>
  )
}
