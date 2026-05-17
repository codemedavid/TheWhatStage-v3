'use client'

import { useRef, useState, useTransition } from 'react'
import { startFlowGenerationAction } from '../actions'
import { StepNav } from '../_components/StepNav'
import { t } from '@/lib/onboarding/i18n'
import type { OnboardingLang } from '@/lib/onboarding/types'

export function FlowForm({
  lang, pageTitle, initialDescription,
}: {
  lang: OnboardingLang; pageId: string; pageTitle: string; initialDescription: string
}) {
  // Uncontrolled input so autofill, password managers, and any non-React-state
  // input mechanism still populates FormData and the length gate below.
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const [length, setLength] = useState(initialDescription.trim().length)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  async function handleSubmit(formData: FormData) {
    start(async () => {
      setError(null)
      try {
        const r = await startFlowGenerationAction(formData)
        // A successful action redirects (throws NEXT_REDIRECT); only error
        // responses reach here.
        if (r?.error) setError(t('flow.error.save', lang))
      } catch (err) {
        // NEXT_REDIRECT is expected — re-throw so Next can navigate.
        throw err
      }
    })
  }

  const canSubmit = length >= 20 && !pending

  return (
    <form action={handleSubmit} className="space-y-4">
      <p className="ob-help">{pageTitle}</p>
      <label className="ob-field">
        <span className="ob-label">{t('flow.description.label', lang)}</span>
        <textarea
          ref={textareaRef}
          name="flow_description"
          rows={6}
          required
          minLength={20}
          maxLength={2000}
          defaultValue={initialDescription}
          onInput={(e) => setLength((e.target as HTMLTextAreaElement).value.trim().length)}
          placeholder={t('flow.description.ph', lang)}
          className="ob-textarea"
        />
        <p
          className="ob-help"
          style={length >= 20 ? { color: 'var(--success)' } : undefined}
          aria-live="polite"
        >
          {t('flow.counter', lang, { length, max: 2000 })}
        </p>
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <StepNav step="flow" lang={lang} continueSlot={
        <button type="submit" disabled={!canSubmit} className="ob-btn ob-btn-primary">
          {pending ? t('flow.generating', lang) : t('flow.generate', lang)}
        </button>
      } />
    </form>
  )
}
