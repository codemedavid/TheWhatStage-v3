'use client'

import { useActionState, useState } from 'react'
import { saveKnowledgeAction } from '../actions'
import { StepNav } from '../_components/StepNav'
import { t } from '@/lib/onboarding/i18n'
import type { OnboardingLang } from '@/lib/onboarding/types'

export interface KnowledgeSection {
  title: string
  body: string
}

interface Props {
  lang: OnboardingLang
  initial: KnowledgeSection[]
}

export function KnowledgeEditor({ lang, initial }: Props) {
  const [sections, setSections] = useState<KnowledgeSection[]>(initial)
  const [state, action, pending] = useActionState(saveKnowledgeAction, {})

  function updateSection(idx: number, patch: Partial<KnowledgeSection>) {
    setSections((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)))
  }
  function removeSection(idx: number) {
    setSections((prev) => prev.filter((_, i) => i !== idx))
  }
  function addSection() {
    setSections((prev) => [...prev, { title: '', body: '' }])
  }

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="sections_json" value={JSON.stringify(sections)} />

      {sections.map((s, i) => (
        <div key={i} className="rounded-md border border-zinc-200 bg-white p-4">
          <div className="flex items-start justify-between gap-2">
            <input
              type="text"
              value={s.title}
              onChange={(e) => updateSection(i, { title: e.target.value })}
              maxLength={120}
              className="w-full border-0 border-b border-transparent bg-transparent text-base font-medium text-zinc-900 focus:border-emerald-600 focus:outline-none"
              placeholder={t('knowledge.section_title_ph', lang)}
            />
            <button
              type="button"
              onClick={() => removeSection(i)}
              className="text-xs text-zinc-500 hover:text-red-600"
              aria-label={t('knowledge.remove', lang)}
            >
              {t('knowledge.remove', lang)}
            </button>
          </div>
          <textarea
            value={s.body}
            onChange={(e) => updateSection(i, { body: e.target.value })}
            rows={4}
            maxLength={4000}
            className="mt-2 w-full resize-y border-0 bg-transparent text-sm text-zinc-800 focus:outline-none"
            placeholder={t('knowledge.section_body_ph', lang)}
          />
        </div>
      ))}

      <button
        type="button"
        onClick={addSection}
        className="text-sm font-medium text-emerald-700 hover:text-emerald-900"
      >
        {t('knowledge.add_section', lang)}
      </button>

      {state.error && (
        <p className="text-sm text-red-600">{t('knowledge.error', lang)}</p>
      )}

      <StepNav
        step="knowledge"
        lang={lang}
        continueSlot={
          <button
            type="submit"
            disabled={pending || sections.length === 0}
            className="inline-flex items-center rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
          >
            {pending ? t('knowledge.saving', lang) : t('knowledge.save', lang)}
          </button>
        }
      />
    </form>
  )
}
