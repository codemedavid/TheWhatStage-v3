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
        <div key={i} className="ob-card">
          <div className="flex items-start justify-between gap-2">
            <input
              type="text"
              value={s.title}
              onChange={(e) => updateSection(i, { title: e.target.value })}
              maxLength={120}
              className="ob-input"
              placeholder={t('knowledge.section_title_ph', lang)}
            />
            <button
              type="button"
              onClick={() => removeSection(i)}
              className="ob-btn ob-btn-text"
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
            className="ob-textarea mt-2"
            placeholder={t('knowledge.section_body_ph', lang)}
          />
        </div>
      ))}

      <button
        type="button"
        onClick={addSection}
        className="ob-btn ob-btn-text"
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
            className="ob-btn ob-btn-primary"
          >
            {pending ? t('knowledge.saving', lang) : t('knowledge.save', lang)}
          </button>
        }
      />
    </form>
  )
}
